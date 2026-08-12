"""Integration tests for the PWA static routes added in Phase 2 (manifest,
service worker, icons, fonts) — same fixture pattern as
test_settings_endpoints.py: reload of app.main with env vars patched, so each
test gets an isolated FRONTEND_DIST pointed at a fake dist/ built for the test
instead of the real frontend/dist/ (which may not even exist in this
environment).

The most important assertion in this file is that GET /sw.js does NOT return
index.html: that's exactly the class of regression the favicon.svg route
was already guarding against, extended to the two new PWA routes registered
in Task 7 of the Phase 2 plan, and now to the /fonts mount added as a
follow-up fix for the same underlying gap (a static file referenced by an
absolute path in the built frontend with no matching backend route).
"""
import pytest
from unittest.mock import patch


# A 1x1 opaque PNG (smallest valid PNG payload), used as the fake icon file.
# Content doesn't matter for these tests — only that it round-trips as
# bytes with the right Content-Type.
FAKE_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082"
)

# Arbitrary bytes standing in for a real woff2 font — content doesn't matter
# for these tests, only that it round-trips as bytes with the right
# Content-Type and is distinguishable from the SPA shell's HTML.
FAKE_WOFF2_BYTES = b"\x77\x4f\x46\x32fake-font-payload-not-a-real-woff2"


def _build_fake_dist(dist_dir):
    (dist_dir / "assets").mkdir(parents=True)
    icons_dir = dist_dir / "icons"
    icons_dir.mkdir()
    (icons_dir / "icon-192.png").write_bytes(FAKE_PNG_BYTES)

    fonts_dir = dist_dir / "fonts"
    fonts_dir.mkdir()
    (fonts_dir / "figtree-variable.woff2").write_bytes(FAKE_WOFF2_BYTES)

    (dist_dir / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    (dist_dir / "index.html").write_text("<html><body>spa shell</body></html>", encoding="utf-8")

    manifest_body = (
        '{"name": "TaskNexus", "icons": [{"src": "/icons/icon-192.png"}]}'
    )
    (dist_dir / "manifest.webmanifest").write_text(manifest_body, encoding="utf-8")
    (dist_dir / "sw.js").write_text("self.addEventListener('install', () => {});", encoding="utf-8")

    return manifest_body


@pytest.fixture
def client(tmp_path):
    dist_dir = tmp_path / "dist"
    manifest_body = _build_fake_dist(dist_dir)

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
            c.manifest_body = manifest_body
            yield c


@pytest.fixture
def client_without_frontend_dist(tmp_path):
    """FRONTEND_DIST pointed at a directory that does not exist — the dev
    flow without a build. The whole static mount block must be skipped, and
    the app must still boot without crashing."""
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path / "projects"),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
        "FRONTEND_DIST": str(tmp_path / "does-not-exist"),
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def test_manifest_returns_200_with_manifest_content_type(client):
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/manifest+json")
    assert r.text == client.manifest_body


def test_service_worker_returns_200_with_javascript_content_type(client):
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/javascript")


def test_service_worker_body_is_not_the_spa_shell(client):
    # The regression this whole task exists to prevent: without a route
    # registered ahead of the catch-all, this would silently return
    # index.html (200 OK) instead of the actual service worker script.
    r = client.get("/sw.js")
    assert "spa shell" not in r.text
    assert "addEventListener" in r.text


def test_icon_returns_200_with_png_content_type(client):
    r = client.get("/icons/icon-192.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == FAKE_PNG_BYTES


def test_font_returns_200_with_woff2_content_type(client):
    r = client.get("/fonts/figtree-variable.woff2")
    assert r.status_code == 200
    assert r.headers["content-type"] == "font/woff2"
    assert r.content == FAKE_WOFF2_BYTES


def test_font_body_is_not_the_spa_shell(client):
    # The regression this route exists to prevent: theme.css references
    # '/fonts/*.woff2' via an absolute path, and without a route registered
    # ahead of the catch-all, this would silently return index.html (200 OK)
    # instead of the actual font file — same failure mode as /sw.js above.
    r = client.get("/fonts/figtree-variable.woff2")
    assert b"spa shell" not in r.content
    assert r.content == FAKE_WOFF2_BYTES


def test_other_spa_route_still_falls_back_to_index_html(client):
    # Regression check: adding routes ahead of the catch-all must not break
    # the catch-all itself for routes that are NOT one of the new PWA paths.
    r = client.get("/some/client/side/route")
    assert r.status_code == 200
    assert "spa shell" in r.text


def test_boot_without_frontend_dist_does_not_crash(client_without_frontend_dist):
    # No static mount at all in this case (dev flow, no build yet) — just
    # confirms the app still serves its API routes normally.
    r = client_without_frontend_dist.get("/manifest.webmanifest")
    assert r.status_code == 404
