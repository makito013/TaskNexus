"""Regression tests for RejectBackslashPathMiddleware (PYSEC-2026-2281).

Starlette 0.38.6 — pinned transitively by FastAPI 0.115.0, which requires
`starlette<0.39.0` — builds static-file targets with
`os.path.join(directory, path)` inside `StaticFiles.lookup_path()`. On Windows
a request path holding `\\\\attacker-host\\share\\file` turns that join into a
UNC path, and the `os.path.realpath()` right after it opens a real outbound SMB
connection, leaking the local account's NTLMv2 hash and stalling an anyio
worker thread for the full TCP timeout (~21s observed against TEST-NET-1).

These tests deliberately do NOT dial a real host: doing so would make the suite
slow and flaky on purpose. Instead they prove the stronger property —
`lookup_path` is never reached at all, so no filesystem or UNC resolution is
even attempted — by spying on that exact method and asserting zero calls.
"""
import pytest
from unittest.mock import patch

from starlette.staticfiles import StaticFiles


# A UNC-shaped path aimed at TEST-NET-1 (RFC 5737, reserved for documentation)
# — the same shape the security review used for its proof of concept.
UNC_ATTACK_PATH = r"/icons/\\192.0.2.1\share\x"

# The same attack, percent-encoded. Browsers normalize a literal backslash to a
# forward slash, so an attacker reaches for this form or a raw socket; the ASGI
# server decodes %5C back into a backslash before routing, which is why the
# middleware inspects the decoded `scope["path"]` and not `raw_path`.
UNC_ATTACK_PATH_ENCODED = "/icons/%5C%5C192.0.2.1%5Cshare%5Cx"

FAKE_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082"
)


def _build_fake_dist(dist_dir):
    """Minimal dist/ tree, mirroring test_pwa_static_routes.py, so all four
    StaticFiles mounts exist and the happy path is exercisable."""
    (dist_dir / "assets").mkdir(parents=True)
    icons_dir = dist_dir / "icons"
    icons_dir.mkdir()
    (icons_dir / "icon-192.png").write_bytes(FAKE_PNG_BYTES)

    fonts_dir = dist_dir / "fonts"
    fonts_dir.mkdir()
    (fonts_dir / "figtree-variable.woff2").write_bytes(b"fake-font-payload")

    (dist_dir / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    (dist_dir / "index.html").write_text("<html><body>spa shell</body></html>", encoding="utf-8")
    (dist_dir / "manifest.webmanifest").write_text('{"name": "TaskNexus"}', encoding="utf-8")
    (dist_dir / "sw.js").write_text("self.addEventListener('install', () => {});", encoding="utf-8")


@pytest.fixture
def client(tmp_path):
    dist_dir = tmp_path / "dist"
    _build_fake_dist(dist_dir)

    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path / "projects"),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
        "FRONTEND_DIST": str(dist_dir),
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


@pytest.fixture
def lookup_path_spy():
    """Wraps StaticFiles.lookup_path — the method holding the vulnerable
    `os.path.join` + `os.path.realpath` pair — so a test can assert it was
    never entered. Keeps the real behaviour so the happy path still works."""
    with patch.object(
        StaticFiles, "lookup_path", autospec=True, side_effect=StaticFiles.lookup_path
    ) as spy:
        yield spy


@pytest.mark.parametrize(
    "attack_path",
    [UNC_ATTACK_PATH, UNC_ATTACK_PATH_ENCODED],
    ids=["literal_backslash", "percent_encoded_backslash"],
)
def test_unc_path_is_rejected_with_400(client, attack_path):
    response = client.get(attack_path)
    assert response.status_code == 400
    assert response.json() == {"detail": "Backslash is not allowed in the request path."}


@pytest.mark.parametrize(
    "attack_path",
    [UNC_ATTACK_PATH, UNC_ATTACK_PATH_ENCODED],
    ids=["literal_backslash", "percent_encoded_backslash"],
)
def test_unc_path_never_reaches_the_static_files_lookup(client, lookup_path_spy, attack_path):
    # The core security assertion: the request is refused before routing, so
    # the vulnerable join/realpath pair is never executed and no SMB
    # connection can be attempted. A fix that merely caught the resulting
    # error afterwards would fail here.
    response = client.get(attack_path)
    assert response.status_code == 400
    assert lookup_path_spy.call_count == 0


def test_backslash_is_rejected_on_api_routes_too(client):
    # The guard is global, not scoped to the static mounts — a backslash is
    # never legitimate anywhere in this app's URLs.
    response = client.get(r"/api/projects\x")
    assert response.status_code == 400


def test_static_file_without_backslash_is_still_served(client, lookup_path_spy):
    # Happy path: the middleware must not disturb normal static serving, and
    # lookup_path must still be reached for a legitimate request (proving the
    # spy above would have caught a leak-through).
    response = client.get("/icons/icon-192.png")
    assert response.status_code == 200
    assert response.content == FAKE_PNG_BYTES
    assert lookup_path_spy.call_count > 0


def test_spa_fallback_without_backslash_is_unaffected(client):
    response = client.get("/some/client/side/route")
    assert response.status_code == 200
    assert "spa shell" in response.text
