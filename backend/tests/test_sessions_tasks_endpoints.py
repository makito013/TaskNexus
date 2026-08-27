import sys

import pytest
from unittest.mock import patch


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def test_create_task_returns_201_and_task_body(client):
    r = client.post(
        "/api/sessions/proj::claude/tasks",
        json={"titulo": "Revisar X", "descricao_markdown": "conteúdo em *markdown*"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["session_key"] == "proj::claude"
    assert body["titulo"] == "Revisar X"
    assert body["descricao_markdown"] == "conteúdo em *markdown*"
    assert body["descricao_html"] is None
    assert body["status"] == "pending"
    assert body["completed_at"] is None
    assert isinstance(body["id"], int)


def test_create_task_accepts_optional_html(client):
    r = client.post(
        "/api/sessions/proj::claude/tasks",
        json={
            "titulo": "Revisar X",
            "descricao_markdown": "md",
            "descricao_html": "<p>md</p>",
        },
    )
    assert r.status_code == 201
    assert r.json()["descricao_html"] == "<p>md</p>"


def test_create_task_missing_required_field_returns_422(client):
    r = client.post("/api/sessions/proj::claude/tasks", json={"titulo": "Sem descrição"})
    assert r.status_code == 422


def test_list_tasks_empty_session_returns_empty_list(client):
    r = client.get("/api/sessions/proj-empty::claude/tasks")
    assert r.status_code == 200
    assert r.json() == []


def test_list_tasks_returns_only_tasks_for_that_session(client):
    client.post("/api/sessions/proj-a::claude/tasks", json={"titulo": "A", "descricao_markdown": "descr A"})
    client.post("/api/sessions/proj-b::claude/tasks", json={"titulo": "B", "descricao_markdown": "descr B"})

    r = client.get("/api/sessions/proj-a::claude/tasks")
    assert r.status_code == 200
    tasks = r.json()
    assert len(tasks) == 1
    assert tasks[0]["titulo"] == "A"


def test_complete_task_marks_done(client):
    created = client.post(
        "/api/sessions/proj::claude/tasks",
        json={"titulo": "Revisar", "descricao_markdown": "descr"},
    ).json()

    r = client.post(f"/api/sessions/proj::claude/tasks/{created['id']}/done")
    assert r.status_code == 200
    assert r.json()["status"] == "done"

    tasks = client.get("/api/sessions/proj::claude/tasks").json()
    assert tasks[0]["status"] == "done"
    assert tasks[0]["completed_at"] is not None


def test_complete_task_idempotent_on_double_call(client):
    created = client.post(
        "/api/sessions/proj::claude/tasks",
        json={"titulo": "Revisar", "descricao_markdown": "descr"},
    ).json()

    r1 = client.post(f"/api/sessions/proj::claude/tasks/{created['id']}/done")
    r2 = client.post(f"/api/sessions/proj::claude/tasks/{created['id']}/done")
    assert r1.status_code == 200
    assert r2.status_code == 200


def test_complete_task_unknown_id_returns_404(client):
    r = client.post("/api/sessions/proj::claude/tasks/999999/done")
    assert r.status_code == 404


def test_complete_task_from_another_session_returns_404(client):
    """Security: session_key in the URL must be part of the WHERE filter —
    a task created for one session cannot be completed via another
    session's URL."""
    created = client.post(
        "/api/sessions/proj-owner::claude/tasks",
        json={"titulo": "Revisar", "descricao_markdown": "descr"},
    ).json()

    r = client.post(f"/api/sessions/proj-other::claude/tasks/{created['id']}/done")
    assert r.status_code == 404

    tasks = client.get("/api/sessions/proj-owner::claude/tasks").json()
    assert tasks[0]["status"] == "pending"


def test_reopen_task_moves_done_back_to_pending(client):
    created = client.post(
        "/api/sessions/proj::claude/tasks",
        json={"titulo": "Revisar", "descricao_markdown": "descr"},
    ).json()
    client.post(f"/api/sessions/proj::claude/tasks/{created['id']}/done")

    r = client.post(f"/api/sessions/proj::claude/tasks/{created['id']}/reopen")
    assert r.status_code == 200
    assert r.json()["status"] == "pending"

    tasks = client.get("/api/sessions/proj::claude/tasks").json()
    assert tasks[0]["status"] == "pending"
    assert tasks[0]["completed_at"] is None


def test_reopen_task_from_another_session_returns_404(client):
    """Security: same isolation guarantee as /done — a task created for one
    session cannot be reopened via another session's URL."""
    created = client.post(
        "/api/sessions/proj-owner::claude/tasks",
        json={"titulo": "Revisar", "descricao_markdown": "descr"},
    ).json()
    client.post(f"/api/sessions/proj-owner::claude/tasks/{created['id']}/done")

    r = client.post(f"/api/sessions/proj-other::claude/tasks/{created['id']}/reopen")
    assert r.status_code == 404

    tasks = client.get("/api/sessions/proj-owner::claude/tasks").json()
    assert tasks[0]["status"] == "done"


def test_reopen_task_unknown_id_returns_404(client):
    r = client.post("/api/sessions/proj::claude/tasks/999999/reopen")
    assert r.status_code == 404


def test_terminate_session_clears_its_tasks(client):
    with patch("app.main._build_pty_cmd", return_value=[sys.executable, "-c", "import time; time.sleep(10)"]):
        with client.websocket_connect("/ws/pty/task-term-test") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time
            time.sleep(0.2)

    client.post(
        "/api/sessions/task-term-test/tasks",
        json={"titulo": "T", "descricao_markdown": "descr"},
    )
    assert len(client.get("/api/sessions/task-term-test/tasks").json()) == 1

    r = client.post("/api/sessions/task-term-test/terminate")
    assert r.status_code == 200

    assert client.get("/api/sessions/task-term-test/tasks").json() == []


def test_reset_session_clears_its_tasks(client):
    with patch("app.main._build_pty_cmd", return_value=[sys.executable, "-c", "import time; time.sleep(10)"]):
        with client.websocket_connect("/ws/pty/task-reset-test") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time
            time.sleep(0.2)

    client.post(
        "/api/sessions/task-reset-test/tasks",
        json={"titulo": "T", "descricao_markdown": "descr"},
    )
    assert len(client.get("/api/sessions/task-reset-test/tasks").json()) == 1

    r = client.post("/api/sessions/task-reset-test/reset")
    assert r.status_code == 200

    assert client.get("/api/sessions/task-reset-test/tasks").json() == []


def test_continue_endpoint_writes_to_active_pty(client):
    """POST .../continue writes the standard message to an already-active PTY
    (PTY-reuse branch of _ensure_pty), without ever erroring."""
    fake_cmd = [
        sys.executable, "-c",
        "import sys,os; data=os.read(0,4096); os.write(1, b'GOT:'+data)",
    ]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/continue-test::claude") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time
            time.sleep(0.1)

            r = client.post("/api/sessions/continue-test::claude/continue")
            assert r.status_code == 200
            assert r.json()["status"] == "sent"

            output = b""
            start = time.time()
            while b"GOT:" not in output and time.time() - start < 2.0:
                try:
                    output += ws.receive_bytes()
                except Exception:
                    break
            assert b"GOT:" in output


def test_continue_endpoint_never_errors_when_no_pty_exists(client):
    """No PTY, no store entry at all for this key, and project_id
    "never-connected" isn't eligible (no .claude/.gemini dir under
    PROJECTS_ROOT) — _ensure_pty's LookupError guard fires because an
    explicit agent_id ("claude") was requested but can't be resolved. The
    endpoint must still never be a 4xx/5xx: it reports status="no_agent"
    instead of crashing with the guard's exception."""
    with patch("app.main._build_pty_cmd", return_value=[sys.executable, "-c", "import time; time.sleep(1)"]):
        r = client.post("/api/sessions/never-connected::claude/continue")
        assert r.status_code == 200
        assert r.json()["status"] == "no_agent"


def test_paste_endpoint_writes_to_active_pty(client):
    """POST .../paste writes the request body's `text` to an already-active
    PTY verbatim — mirrors test_continue_endpoint_writes_to_active_pty, but
    asserts the exact bytes received on the PTY side contain no \\r/\\n
    beyond what was in `text` (continue's fixed message always appends
    '\\r'; paste must never do that).

    The fake child disables the Windows console's default line-input mode
    (ENABLE_LINE_INPUT) before reading — without it, a plain os.read() on a
    fresh Windows console blocks until it sees \\r, which paste's payload
    deliberately never sends. Real interactive TUIs (the actual `claude`
    CLI included) already do this themselves to process keystrokes as they
    arrive rather than waiting for Enter; this fake double has to do it
    explicitly since it's just a bare script, not a real raw-mode app."""
    fake_cmd = [
        sys.executable, "-c",
        "import sys, os\n"
        "if sys.platform == 'win32':\n"
        "    import ctypes\n"
        "    k = ctypes.windll.kernel32\n"
        "    h = k.GetStdHandle(-10)\n"
        "    m = ctypes.c_uint32()\n"
        "    k.GetConsoleMode(h, ctypes.byref(m))\n"
        "    k.SetConsoleMode(h, m.value & ~0x0002 & ~0x0004)\n"
        "else:\n"
        "    import termios, tty\n"
        "    tty.setraw(0)\n"
        "data = os.read(0, 4096)\n"
        "os.write(1, b'GOT:' + data)\n",
    ]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/paste-test::claude") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time
            time.sleep(0.1)

            r = client.post(
                "/api/sessions/paste-test::claude/paste",
                json={"text": "/tmp/some/attachment.pdf "},
            )
            assert r.status_code == 200
            assert r.json()["status"] == "sent"

            output = b""
            start = time.time()
            while b"GOT:" not in output and time.time() - start < 2.0:
                try:
                    output += ws.receive_bytes()
                except Exception:
                    break
            # Windows' ConPTY always prefixes a session's output with its own
            # VT setup sequences (mode-setting, clear-screen, console title)
            # ahead of anything the child writes — unlike a bare POSIX pty,
            # it isn't a raw byte pipe. Anchor on the child's own marker
            # instead of the whole buffer, and check for a stray \r/\n only
            # in what the child actually produced — that's the property this
            # test cares about (paste must never submit), not byte-exact
            # equality with the full ConPTY stream.
            payload = output[output.index(b"GOT:"):]
            assert payload.startswith(b"GOT:/tmp/some/attachment.pdf")
            assert b"\r" not in payload and b"\n" not in payload


def test_paste_endpoint_never_errors_when_no_pty_exists(client):
    """Same HTTP-contract tolerance as test_continue_endpoint_never_errors_when_no_pty_exists:
    project_id "paste-never-connected" isn't eligible, so the LookupError
    guard in _ensure_pty fires for the explicit agent_id "claude" — the
    endpoint still returns 200 with status="no_agent", never 4xx/5xx."""
    with patch("app.main._build_pty_cmd", return_value=[sys.executable, "-c", "import time; time.sleep(1)"]):
        r = client.post(
            "/api/sessions/paste-never-connected::claude/paste",
            json={"text": "hello"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "no_agent"
