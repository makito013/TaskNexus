"""Resume-failure detection must survive narrow-PTY rendering.

A narrow ConPTY (cols 43/60) emits `No\x1b[1Cconversation\x1b[1Cfound...`
instead of literal spaces, and may wrap inside the marker, so the raw
substring search never matched and no `resume_failed` frame was sent.
"""
import asyncio
import json
import sys
from unittest.mock import patch

import pytest

ESC = b"\x1b"
CLAUDE_MARKER = b"No conversation found with session ID"
CLAUDE_MARKERS = (CLAUDE_MARKER,)


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    env = {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
        "BOARD_UPLOADS_ROOT": str(tmp_path / "uploads"),
    }
    with patch.dict("os.environ", env):
        import os

        os.environ.pop("HOOK_LOOPBACK_PORT", None)
        import importlib

        import app.main as main_mod

        importlib.reload(main_mod)
        from fastapi.testclient import TestClient

        with TestClient(main_mod.app) as c:
            yield c


def _contains(data, markers=CLAUDE_MARKERS):
    from app.main import _output_contains_marker

    return _output_contains_marker(data, markers)


def test_normalize_turns_cursor_forward_into_spaces():
    from app.main import _normalize_pty_output

    assert _normalize_pty_output(b"No" + ESC + b"[1Cconversation") == b"No conversation"
    assert _normalize_pty_output(b"a" + ESC + b"[3Cb") == b"a   b"
    assert _normalize_pty_output(b"a" + ESC + b"[Cb") == b"a b"


def test_normalize_drops_color_osc_and_other_escapes():
    from app.main import _normalize_pty_output

    data = (
        ESC + b"[31;1mError" + ESC + b"[0m" + ESC + b"]0;title\x07"
        + ESC + b"]8;;http://x" + ESC + bytes([92]) + b"link" + ESC + b"[2K" + ESC + b"[?25l" + ESC + b"M"
    )
    assert _normalize_pty_output(data) == b"Errorlink"


def test_normalize_removes_wrap_crlf():
    from app.main import _normalize_pty_output

    assert _normalize_pty_output(b"No conver\r\nsation found") == b"No conversation found"


def test_normalize_leaves_plain_wide_output_untouched():
    from app.main import _normalize_pty_output

    assert _normalize_pty_output(CLAUDE_MARKER + b": abc") == CLAUDE_MARKER + b": abc"


def test_marker_found_in_wide_output():
    assert _contains(CLAUDE_MARKER + b": 1234")


def test_marker_found_with_cursor_forward_spaces():
    data = (
        b"No" + ESC + b"[1Cconversation" + ESC + b"[1Cfound" + ESC + b"[1Cwith"
        + ESC + b"[1Csession" + ESC + b"[1CID: 1234"
    )
    assert _contains(data)


def test_marker_found_with_color_sequences_inside():
    data = ESC + b"[31mNo conversation" + ESC + b"[0m found with session ID: x"
    assert _contains(data)


def test_marker_found_when_wrapped_with_crlf_mid_marker():
    assert _contains(b"No conversation fo\r\nund with sess\r\nion ID: x")
    # wrap landing exactly where a space belongs
    assert _contains(b"No conversation\r\nfound with session\r\nID: x")


def test_marker_found_across_chunks_with_escape_split_at_boundary():
    full = (
        b"No" + ESC + b"[1Cconversation" + ESC + b"[1Cfound" + ESC + b"[1Cwith"
        + ESC + b"[1Csession" + ESC + b"[1CID: x"
    )
    for cut in range(1, len(full)):
        accumulated = b""
        found = False
        for chunk in (full[:cut], full[cut:]):
            accumulated += chunk
            found = _contains(accumulated)
        assert found, "marker missed with the buffer cut at byte %d" % cut


def test_no_false_positive_on_unrelated_or_partial_output():
    assert not _contains(b"")
    assert not _contains(b"Welcome to Claude Code" + ESC + b"[1C v2")
    assert not _contains(b"No conversation found")  # missing the session ID part
    assert not _contains(b"No conversation found with" + ESC + b"[1C")
    assert not _contains(b"anything", ())  # cursor has no markers


def test_every_registered_signature_marker_is_normalized():
    from app.main import _RESUME_FAILURE_SIGNATURES

    for ia, signature in _RESUME_FAILURE_SIGNATURES.items():
        for marker in signature["markers"]:
            noisy = marker.replace(b" ", ESC + b"[1C")
            assert _contains(noisy, signature["markers"]), ia


NOISY_MARKER = (
    b"No" + ESC + b"[1Cconversation" + ESC + b"[1Cfound" + ESC + b"[1Cwith"
    + ESC + b"[1Csession" + ESC + b"[1CID: x"
)
# The marker is complete once "ID" has arrived; the trailing ": x" is extra.
NOISY_MARKER_END = NOISY_MARKER.index(b"ID: x") + 2
JUNK_CHUNK = (ESC + b"[38;2;10;20;30mfiller line of redraw output" + ESC + b"[0m" + b"\r\n") * 100


def _probe(chunks, markers=CLAUDE_MARKERS):
    """Mimic the resume probe loop; return the index of the matching chunk."""
    from app.main import _output_contains_marker, _resume_probe_window

    accumulated = b""
    for index, chunk in enumerate(chunks):
        accumulated += chunk
        if _output_contains_marker(_resume_probe_window(accumulated, chunk), markers):
            return index
    return None


def test_marker_split_at_tail_window_boundary_after_lots_of_junk():
    from app.main import _RESUME_PROBE_OVERLAP

    junk = [JUNK_CHUNK] * 200  # ~500 KB, far beyond the window
    assert len(JUNK_CHUNK) > _RESUME_PROBE_OVERLAP
    assert _probe(junk) is None
    for cut in range(1, len(NOISY_MARKER)):
        chunks = junk + [NOISY_MARKER[:cut], NOISY_MARKER[cut:]]
        expected = len(junk) if cut >= NOISY_MARKER_END else len(junk) + 1
        assert _probe(chunks) == expected, "wrong match at cut %d" % cut


def test_marker_split_across_many_small_chunks_after_junk():
    chunks = [JUNK_CHUNK] * 50 + [bytes([b]) for b in NOISY_MARKER]
    assert _probe(chunks) == 50 + NOISY_MARKER_END - 1


def test_huge_cursor_forward_parameter_does_not_raise():
    from app.main import _PTY_MAX_CURSOR_FORWARD, _normalize_pty_output

    for digits in (5, 4300, 4301, 100000):
        data = b"a" + ESC + b"[" + b"9" * digits + b"Cb"
        assert _normalize_pty_output(data) == b"a" + b" " * _PTY_MAX_CURSOR_FORWARD + b"b"
    assert _contains(ESC + b"[" + b"9" * 5000 + b"C" + CLAUDE_MARKER)


def test_probe_cost_per_chunk_is_bounded_by_the_window():
    from unittest.mock import patch

    import app.main as main_mod

    normalized_sizes = []
    original = main_mod._normalize_pty_output

    def counting(data):
        normalized_sizes.append(len(data))
        return original(data)

    chunk = b"x" * 1000
    chunk_count = 400  # 400 KB accumulated in total
    with patch.object(main_mod, "_normalize_pty_output", counting):
        assert _probe([chunk] * chunk_count) is None

    bound = len(chunk) + main_mod._RESUME_PROBE_OVERLAP
    assert len(normalized_sizes) == chunk_count
    assert max(normalized_sizes) <= bound
    assert sum(normalized_sizes) <= chunk_count * bound


class _FakeWebSocket:
    def __init__(self, messages):
        self.messages = messages
        self.sent_bytes = []
        self.sent_text = []
        self.closed_code = None

    async def accept(self):
        pass

    async def receive(self):
        if not self.messages:
            await asyncio.Event().wait()
        return self.messages.pop(0)

    async def send_bytes(self, data):
        self.sent_bytes.append(data)

    async def send_text(self, data):
        self.sent_text.append(data)

    async def close(self, code=1000, reason=None):
        self.closed_code = code


@pytest.mark.asyncio
async def test_resume_failed_frame_sent_when_pty_output_uses_cursor_forward(client):
    from app.main import _active_connections, _active_tasks, pty_endpoint, store

    _active_connections.clear()
    _active_tasks.clear()
    await store.set("narrow-pty-test", "old-session-uuid")

    ws = _FakeWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 43, "rows": 24,
        })}
    ])

    script = (
        "import sys; E = chr(27) + '[1C'; "
        "sys.stdout.write('No' + E + 'conversation' + E + 'found' + E + 'with' "
        "+ E + 'session' + E + 'ID: ' + sys.argv[1] + chr(10)); "
        "sys.stdout.flush(); sys.exit(1)"
    )

    def build_cmd(session_id, resume, system_prompt, base_cmd=None):
        assert resume
        return [sys.executable, "-c", script, session_id]

    with patch("app.main._build_pty_cmd", side_effect=build_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "narrow-pty-test"))
            await asyncio.sleep(1.2)

            assert len(ws.sent_text) == 1
            assert json.loads(ws.sent_text[0]) == {
                "type": "resume_failed",
                "session_key": "narrow-pty-test",
            }
            assert await store.get("narrow-pty-test") == "old-session-uuid"

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
