import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock
import json
import os
import sys
import time
import asyncio
from pathlib import Path
from fastapi import WebSocketDisconnect

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
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def _pty_pid(proc):
    """proc.proc (subprocess.Popen) is the POSIX process handle; on Windows
    the process lives in proc._winpty_proc instead, which exposes its own
    .pid attribute (see winpty/ptyprocess.py)."""
    return proc.proc.pid if proc.proc is not None else proc._winpty_proc.pid


# Exit code Windows reports for a process that has not exited yet.
_STILL_ACTIVE = 259


def _process_is_alive(pid):
    """True while the OS still reports `pid` as a *running* process.

    Windows needs an explicit exit-code probe; `os.kill(pid, 0)` does not work
    as a liveness check there, in both directions:

    - It only proves `OpenProcess()` succeeded, and a PID stays openable after
      the process exits for as long as anything still holds a handle to it.
      winpty holds one, so `os.kill(pid, 0)` returns cleanly for a PTY child
      that is already dead — reporting "alive" for a corpse.
    - For a PID that is genuinely gone it raises `OSError(EINVAL, winerror 87)`,
      not `ProcessLookupError`, so `pytest.raises(ProcessLookupError)` can never
      pass on this platform even when the process really is gone.

    `GetExitCodeProcess` is the actual signal: STILL_ACTIVE means running,
    anything else means exited. (A process that deliberately exits with code
    259 is indistinguishable from a running one — a documented Win32 quirk,
    harmless here since these fixtures never exit with that code.)
    """
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == _STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _poll_until(predicate, timeout=2.5, interval=0.05):
    """Blocking poll of `predicate` until it is true or `timeout` elapses;
    returns the final result. Used instead of a fixed sleep so a slow teardown
    shows up as a real failure rather than as a flake tied to one machine's
    timing.

    Deliberately NOT named `_wait_until`: this module already defines an
    `async def _wait_until` further down, and since that one is defined later
    it would win the module namespace. Calling it from a sync test would
    return an un-awaited coroutine — always truthy, so every assertion built
    on it would pass vacuously.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def test_status_endpoint(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_projects_endpoint(client):
    r = client.get("/api/projects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(p["id"] == "meu-projeto" for p in data)


def test_pty_websocket_streams_raw_bytes_bidirectionally(client):
    """init frame spawns a PTY; raw binary stdin/stdout are bridged with no JSON envelope."""
    fake_cmd = [sys.executable, "-c", "import sys,os; data=os.read(0,4096); os.write(1, b'GOT:'+data)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/echo-test") as ws:
            ws.send_text(json.dumps({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            }))
            import time
            time.sleep(0.1)
            # \r (not just \n) is required to unblock a plain os.read() on a
            # Windows console in its default line-input mode — ConPTY leaves
            # ENABLE_LINE_INPUT on unless the child process disables it
            # itself (real interactive TUIs like the claude CLI do; this bare
            # echo script doesn't, so it needs the explicit \r here).
            ws.send_bytes(b"hi\r\n")
            output = b""
            start = time.time()
            while b"GOT:hi" not in output and time.time() - start < 2.0:
                try:
                    chunk = ws.receive_bytes()
                    output += chunk
                except Exception:
                    break
            assert b"GOT:hi" in output


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="Known hang on native Windows: dispatching a resize control frame "
    "(proc.resize() -> pywinpty's setwinsize()) immediately before reading "
    "the child's echoed bytes back blocks forever in ws.receive_bytes(). "
    "Root cause not yet isolated — surfaced 2026-08-04 while fixing other "
    "Windows-port test gaps (see PIPELINE-STATE-winerror121.md history / "
    "agentes/CONTEXTO.md). Needs dedicated investigation into whether "
    "pywinpty's setwinsize() has its own blocking/thread-affinity quirk, "
    "separate from the already-documented isalive()/read-loop gotchas.",
)
def test_pty_websocket_resize_frame_does_not_error(client):
    """A resize JSON control frame is dispatched without disrupting the binary stdin/stdout path."""
    fake_cmd = [sys.executable, "-c", "import sys,os; data=os.read(0,4096); os.write(1, b'GOT:'+data)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/resize-test") as ws:
            ws.send_text(json.dumps({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            }))
            import time
            time.sleep(0.1)
            ws.send_text(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
            # See the comment in test_pty_websocket_streams_raw_bytes_bidirectionally
            # above — \r is required to unblock os.read() under Windows's
            # default console line-input mode.
            ws.send_bytes(b"ping\r\n")
            output = b""
            start = time.time()
            while b"GOT:ping" not in output and time.time() - start < 2.0:
                try:
                    chunk = ws.receive_bytes()
                    output += chunk
                except Exception:
                    break
            assert b"GOT:ping" in output


def test_pty_websocket_init_frame_sets_winsize_before_spawn(client):
    """The init frame's cols/rows must already be the pty's winsize the
    instant the process is spawned — not only after the later "resize"
    control frame. Regression test for the "tela preta" bug: TUIs that query
    window size once at startup (e.g. antigravity/Bubble Tea) would see 0x0
    if the winsize were only applied by a resize frame arriving after spawn.

    On Windows there's no ioctl/TIOCGWINSZ equivalent to query the pty's
    actual winsize after the fact — ConPTY's dimensions are a `spawn()`
    parameter (see PTYProcess._spawn_windows's `dimensions=(rows, cols)`),
    applied atomically with the process creation itself, so there's no
    separate "set it too late" step to regress against in the first place.
    proc.cols/proc.rows (set in __init__ before _spawn() runs) are the
    equivalent, meaningful assertion there."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(1)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        from app.main import pty_manager
        with client.websocket_connect("/ws/pty/winsize-test") as ws:
            ws.send_text(json.dumps({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 120, "rows": 40,
            }))
            import time
            proc = None
            for _ in range(50):
                proc = pty_manager.get("winsize-test")
                if proc is not None:
                    break
                time.sleep(0.05)
            assert proc is not None
            if sys.platform == "win32":
                assert (proc.rows, proc.cols) == (40, 120)
            else:
                import fcntl, termios, struct
                winsize = fcntl.ioctl(proc.master_fd, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
                rows, cols, _, _ = struct.unpack("HHHH", winsize)
                assert (rows, cols) == (40, 120)


def test_pty_websocket_terminates_process_on_disconnect(client):
    """Closing the WebSocket terminates the underlying PTY process after grace period."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(5)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        from app.main import pty_manager
        with client.websocket_connect("/ws/pty/term-test") as ws:
            ws.send_text(json.dumps({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            }))
            proc = None
            for _ in range(50):
                proc = pty_manager.get("term-test")
                if proc is not None:
                    break
                time.sleep(0.05)
            assert proc is not None
            pid = _pty_pid(proc)

        # ws is closed. CLEANUP_DELAY is 0.1s, but poll instead of sleeping a
        # fixed amount: the two conditions below settle independently, and the
        # process only disappears once the OS has reaped it.
        assert _poll_until(lambda: pty_manager.get("term-test") is None), (
            "PTY session was never dropped from the manager after disconnect"
        )
        assert _poll_until(lambda: not _process_is_alive(pid)), (
            f"PTY child process {pid} survived the grace-period cleanup"
        )


def test_sessions_active_reports_running_then_idle(client):
    """GET /api/sessions/active reflects real PTY output activity, transitioning
    from 'running' to 'idle' once ACTIVITY_TIMEOUT elapses with no new output."""
    fake_cmd = [sys.executable, "-c", "print('hi'); import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.ACTIVITY_TIMEOUT", 0.3):
            with client.websocket_connect("/ws/pty/active-test") as ws:
                ws.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                import time
                output = b""
                start = time.time()
                while b"hi" not in output and time.time() - start < 2.0:
                    try:
                        output += ws.receive_bytes()
                    except Exception:
                        break

                r = client.get("/api/sessions/active")
                assert r.status_code == 200
                data = r.json()
                assert data.get("active-test", {}).get("status") == "running"

                time.sleep(0.4)  # past the patched ACTIVITY_TIMEOUT

                r2 = client.get("/api/sessions/active")
                data2 = r2.json()
                assert data2.get("active-test", {}).get("status") == "idle"


def test_sessions_active_omits_keys_with_no_pty(client):
    """A session_key with no active PTY is entirely absent from the response."""
    r = client.get("/api/sessions/active")
    assert r.status_code == 200
    data = r.json()
    assert "no-such-session" not in data


def test_build_pty_cmd_appends_system_prompt_for_fresh_session_only(client):
    """Fresh sessions get --append-system-prompt; --resume sessions never do."""
    from app.main import _build_pty_cmd

    fresh_cmd = _build_pty_cmd("sid-1", resume=False, system_prompt="You are agent X")
    assert "--append-system-prompt" in fresh_cmd
    assert "You are agent X" in fresh_cmd

    resume_cmd = _build_pty_cmd("sid-1", resume=True, system_prompt="You are agent X")
    assert "--append-system-prompt" not in resume_cmd
    assert "You are agent X" not in resume_cmd


def test_build_agent_cmd_delegates_to_claude_contract_for_none_or_claude_agent(client):
    """agent=None and agent.ia='claude' must produce the exact same argv as _build_pty_cmd."""
    from app.main import _build_agent_cmd, _build_pty_cmd
    from app.models import Agent

    claude_agent = Agent(id="claude", nome="Claude", papel="Assistente", ia="claude", cmd=["claude"])

    for agent in (None, claude_agent):
        fresh = _build_agent_cmd(agent, "sid-1", resume=False, system_prompt="ctx")
        assert fresh == _build_pty_cmd("sid-1", resume=False, system_prompt="ctx")

        resumed = _build_agent_cmd(agent, "sid-1", resume=True, system_prompt="ctx")
        assert resumed == _build_pty_cmd("sid-1", resume=True, system_prompt="ctx")


def test_build_agent_cmd_uses_agent_cmd_for_non_claude_agent():
    """Non-claude agents (e.g. Gemini/agy) must launch their own cmd, never
    'claude', with --dangerously-skip-permissions (verified experimentally
    2026-08-26: the real agy binary has no --session-id flag at all — it
    rejects it as unrecognized and dies on startup, which is exactly the
    "antigravity won't open" bug this test now guards against; --session-id
    must never reappear here)."""
    from app.main import _build_agent_cmd
    from app.models import Agent

    gemini_agent = Agent(id="gemini", nome="Gemini", papel="Assistente", ia="gemini", cmd=["agy"])

    fresh = _build_agent_cmd(gemini_agent, "sid-1", resume=False, system_prompt="You are agent X")
    assert fresh[0] == "agy"
    assert "claude" not in fresh
    assert "--dangerously-skip-permissions" in fresh
    assert "--session-id" not in fresh
    assert "--prompt-interactive" in fresh
    assert fresh[fresh.index("--prompt-interactive") + 1] == "You are agent X"

    fresh_no_prompt = _build_agent_cmd(gemini_agent, "sid-1", resume=False, system_prompt=None)
    assert "--prompt-interactive" not in fresh_no_prompt


def test_build_agent_cmd_uses_continue_resume_for_non_claude_agent():
    """resume=True must translate to `--continue` for non-claude agents
    (antigravity/gemini/agy) — NOT `--resume <session_id>`. Verified
    experimentally (2026-08-26) that agy has no --resume flag, and that its
    real resume flag, --conversation <id>, does not honor externally
    generated ids anyway (a made-up id always logs "conversation not found"
    and starts a new conversation instead of attaching to ours) — so there
    is no way to pin a conversation to an id we control, and --continue
    ("most recent") is the only working resume semantics available, despite
    the multi-chat ambiguity that implies. system_prompt is only ever
    attached on a fresh session — on resume the agent already has it, so
    --prompt-interactive must NOT appear here."""
    from app.main import _build_agent_cmd
    from app.models import Agent

    gemini_agent = Agent(id="gemini", nome="Gemini", papel="Assistente", ia="gemini", cmd=["agy"])

    resumed = _build_agent_cmd(gemini_agent, "sid-1", resume=True, system_prompt="You are agent X")
    assert "--continue" in resumed
    assert "--resume" not in resumed
    assert "--session-id" not in resumed
    assert "--dangerously-skip-permissions" in resumed
    assert "--prompt-interactive" not in resumed
    assert "You are agent X" not in resumed


def test_build_agent_cmd_uses_custom_cmd_for_claude_agent_with_non_default_cmd():
    """A global agent registered with ia="claude" and a custom cmd (the
    claude-vs-claude-work use case) must have that cmd used as the spawn
    base — not silently discarded in favor of the hardcoded "claude"."""
    from app.main import _build_agent_cmd
    from app.models import Agent

    claude_work_agent = Agent(
        id="claude-work", nome="Claude (Work)", papel="Assistente",
        ia="claude", cmd=["claude-work", "--profile", "work"],
    )

    cmd = _build_agent_cmd(claude_work_agent, "sid-1", resume=False, system_prompt=None)

    assert cmd[0] == "claude-work"
    assert "--profile" in cmd
    assert "work" in cmd
    assert "--dangerously-skip-permissions" not in cmd
    assert "--session-id" in cmd
    assert "sid-1" in cmd


def test_build_agent_cmd_still_injects_hooks_for_custom_claude_cmd():
    """The Stop-hook --settings and --mcp-config injection must still happen
    for a custom-cmd claude agent — only the base executable/leading args
    change, everything _build_pty_cmd appends stays the same."""
    from app.main import _build_agent_cmd, _build_stop_hook_settings
    from app.models import Agent

    claude_work_agent = Agent(
        id="claude-work", nome="Claude (Work)", papel="Assistente",
        ia="claude", cmd=["claude-work"],
    )

    resumed = _build_agent_cmd(claude_work_agent, "sid-1", resume=True, system_prompt=None)
    assert resumed[0] == "claude-work"
    assert "--resume" in resumed
    assert "sid-1" in resumed
    assert "--settings" in resumed
    assert _build_stop_hook_settings() in resumed
    assert "--mcp-config" in resumed


def test_build_agent_cmd_returns_raw_cmd_for_terminal_agent():
    """Um agente ia="terminal" é um terminal puro — nenhuma flag extra deve
    ser concatenada (nem o contrato --settings/--resume do claude, nem
    --dangerously-skip-permissions/--prompt-interactive do ramo genérico)."""
    from app.main import _build_agent_cmd
    from app.models import Agent

    terminal_agent = Agent(
        id="terminal", nome="Terminal", papel="Terminal puro",
        ia="terminal", cmd=["powershell"],
    )

    cmd = _build_agent_cmd(terminal_agent, "sid-1", resume=False, system_prompt=None)
    assert cmd == ["powershell"]


def test_build_agent_cmd_ignores_system_prompt_and_resume_for_terminal_agent():
    from app.main import _build_agent_cmd
    from app.models import Agent

    terminal_agent = Agent(
        id="terminal", nome="Terminal", papel="Terminal puro",
        ia="terminal", cmd=["bash"],
    )

    cmd = _build_agent_cmd(terminal_agent, "sid-1", resume=True, system_prompt="ignorado")
    assert cmd == ["bash"]
    assert "ignorado" not in cmd
    assert "sid-1" not in cmd


def test_build_pty_cmd_base_cmd_defaults_to_claude():
    """Omitting base_cmd (every pre-existing call site) must be identical to
    passing base_cmd=["claude"] explicitly — pure backward compatibility."""
    from app.main import _build_pty_cmd

    default = _build_pty_cmd("sid-1", resume=False, system_prompt=None)
    explicit = _build_pty_cmd("sid-1", resume=False, system_prompt=None, base_cmd=["claude"])
    assert default == explicit
    assert default[0] == "claude"


def test_pty_websocket_gemini_project_uses_agent_cmd_not_claude(client, tmp_path):
    """A project eligible via .gemini/ with a registered global gemini agent
    must spawn that agent's own cmd, not 'claude'. Eligibility (the .gemini/
    folder) no longer auto-creates an agent — the agent list comes entirely
    from the Global Agent Registry, so one must be registered here."""
    import app.main as main_mod

    gemini_proj = main_mod.PROJECTS_ROOT
    (Path(gemini_proj) / "meu-projeto-gemini" / ".gemini").mkdir(parents=True)

    client.post("/api/agents", json={
        "id": "gemini", "nome": "Gemini", "papel": "Assistente",
        "ia": "gemini", "cmd": ["agy"],
    })

    captured = {}
    real_build_agent_cmd = main_mod._build_agent_cmd

    def spy(agent, session_id, resume, system_prompt):
        captured["agent"] = agent
        return [sys.executable, "-c", "import time; time.sleep(2)"]

    with patch("app.main._build_agent_cmd", side_effect=spy):
        with client.websocket_connect("/ws/pty/gemini-cmd-test") as ws:
            ws.send_text(json.dumps({
                "type": "init", "project_id": "meu-projeto-gemini", "agent_id": None,
                "cols": 80, "rows": 24,
            }))
            import time
            time.sleep(0.2)

    assert captured.get("agent") is not None
    assert captured["agent"].ia == "gemini"
    assert captured["agent"].cmd == ["agy"]


def test_pty_websocket_reconnection_reuses_process(client):
    """Closing a WebSocket does not terminate the PTY immediately; reconnecting reuses it."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.CLEANUP_DELAY", 2.0):
            from app.main import pty_manager
            with client.websocket_connect("/ws/pty/recon-test") as ws:
                ws.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                import time
                time.sleep(0.1)
                proc = pty_manager.get("recon-test")
                assert proc is not None
                pid1 = _pty_pid(proc)

            # WS closed. Wait 0.2s (less than 2.0s CLEANUP_DELAY). Process should still exist.
            time.sleep(0.2)
            proc2 = pty_manager.get("recon-test")
            assert proc2 is not None
            assert _pty_pid(proc2) == pid1

            # Connect WS 2. Process should be reused.
            with client.websocket_connect("/ws/pty/recon-test") as ws2:
                ws2.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                time.sleep(0.1)
                proc3 = pty_manager.get("recon-test")
                assert proc3 is not None
                assert _pty_pid(proc3) == pid1


def test_pty_websocket_reconnection_replays_scrollback_on_reuse(client):
    """Reconnecting to a still-alive PTY (reuse path) receives a replay of
    that PTY's recent output as the first bytes, without the process
    producing anything new."""
    import threading
    import queue as queue_mod

    fake_cmd = [sys.executable, "-c", "print('scrollback-marker'); import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.CLEANUP_DELAY", 2.0):
            with client.websocket_connect("/ws/pty/scrollback-test") as ws:
                ws.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                import time
                output = b""
                start = time.time()
                while b"scrollback-marker" not in output and time.time() - start < 2.0:
                    try:
                        output += ws.receive_bytes()
                    except Exception:
                        break
                assert b"scrollback-marker" in output

            # ws closed. Wait less than CLEANUP_DELAY (2.0s) so the process is reused.
            time.sleep(0.2)

            with client.websocket_connect("/ws/pty/scrollback-test") as ws2:
                ws2.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))

                # receive_bytes() blocks indefinitely with no built-in timeout;
                # run it on a daemon thread and bound the wait so a pre-fix
                # (no-replay) backend fails fast instead of hanging the suite.
                result_q: queue_mod.Queue = queue_mod.Queue()

                def _recv():
                    try:
                        result_q.put(ws2.receive_bytes())
                    except Exception as exc:
                        result_q.put(exc)

                t = threading.Thread(target=_recv, daemon=True)
                t.start()
                try:
                    first_chunk = result_q.get(timeout=2.0)
                except queue_mod.Empty:
                    pytest.fail("Reconnecting client received no scrollback replay within 2.0s")

                assert not isinstance(first_chunk, Exception), first_chunk
                assert b"scrollback-marker" in first_chunk


def test_pty_websocket_reconnection_with_different_geometry_prefixes_clear_before_scrollback(client):
    """Root-cause regression test for 'texto desconfigurado' on reconnect
    (iPad keyboard opening/closing, rotation, Split View all change cols/rows
    across a disconnect). Reconnecting to a still-alive, reused PTY with
    cols/rows DIFFERENT from what the process last had must prefix the
    replayed scrollback with a full terminal clear (\\x1b[2J\\x1b[3J\\x1b[H)
    — replaying old-geometry scrollback raw against a differently-sized
    xterm.js grid is exactly what produced the garbled screen. The snapshot
    itself must still be sent in full (never suppressed) — the agent process
    may be idle at a prompt and not redraw on its own after SIGWINCH."""
    import threading
    import queue as queue_mod

    fake_cmd = [sys.executable, "-c", "print('scrollback-marker'); import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.CLEANUP_DELAY", 2.0):
            with client.websocket_connect("/ws/pty/geometry-change-test") as ws:
                ws.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                import time
                output = b""
                start = time.time()
                while b"scrollback-marker" not in output and time.time() - start < 2.0:
                    try:
                        output += ws.receive_bytes()
                    except Exception:
                        break
                assert b"scrollback-marker" in output

            # ws closed. Wait less than CLEANUP_DELAY (2.0s) so the process is reused.
            time.sleep(0.2)

            # Reconnect with DIFFERENT geometry than the first connection.
            with client.websocket_connect("/ws/pty/geometry-change-test") as ws2:
                ws2.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 120, "rows": 40,
                }))

                result_q: queue_mod.Queue = queue_mod.Queue()

                def _recv():
                    try:
                        result_q.put(ws2.receive_bytes())
                    except Exception as exc:
                        result_q.put(exc)

                t = threading.Thread(target=_recv, daemon=True)
                t.start()
                try:
                    first_chunk = result_q.get(timeout=2.0)
                except queue_mod.Empty:
                    pytest.fail("Reconnecting client with new geometry received nothing within 2.0s")

                assert not isinstance(first_chunk, Exception), first_chunk
                assert first_chunk.startswith(b"\x1b[2J\x1b[3J\x1b[H"), (
                    "expected the clear sequence to prefix the scrollback replay "
                    f"when geometry changed; got: {first_chunk!r}"
                )
                assert b"scrollback-marker" in first_chunk

            # The PTY's own geometry must have actually been updated to match
            # the reconnecting client (proc.resize() called before snapshot).
            from app.main import pty_manager
            proc = pty_manager.get("geometry-change-test")
            assert proc is not None
            assert (proc.cols, proc.rows) == (120, 40)


def test_pty_websocket_reconnection_same_geometry_sends_snapshot_without_clear_prefix(client):
    """Regression guard for the already-fixed 'blank-terminal-on-return' bug
    (the reason a bare, unprefixed scrollback replay exists at all): when the
    reconnecting client's geometry is IDENTICAL to the PTY's current
    geometry, behavior must be byte-for-byte the same as before this fix —
    no clear-sequence prefix, just the raw snapshot. Prefixing unconditionally
    regardless of geometry would be an equally real regression (a
    superfluous, jarring clear on every ordinary same-size reconnect)."""
    import threading
    import queue as queue_mod

    fake_cmd = [sys.executable, "-c", "print('scrollback-marker'); import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.CLEANUP_DELAY", 2.0):
            with client.websocket_connect("/ws/pty/same-geometry-test") as ws:
                ws.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))
                import time
                output = b""
                start = time.time()
                while b"scrollback-marker" not in output and time.time() - start < 2.0:
                    try:
                        output += ws.receive_bytes()
                    except Exception:
                        break
                assert b"scrollback-marker" in output

            time.sleep(0.2)

            from app.main import pty_manager
            proc = pty_manager.get("same-geometry-test")
            assert proc is not None
            expected_snapshot = proc.snapshot()

            # Reconnect with the SAME geometry as the first connection.
            with client.websocket_connect("/ws/pty/same-geometry-test") as ws2:
                ws2.send_text(json.dumps({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                }))

                result_q: queue_mod.Queue = queue_mod.Queue()

                def _recv():
                    try:
                        result_q.put(ws2.receive_bytes())
                    except Exception as exc:
                        result_q.put(exc)

                t = threading.Thread(target=_recv, daemon=True)
                t.start()
                try:
                    first_chunk = result_q.get(timeout=2.0)
                except queue_mod.Empty:
                    pytest.fail("Reconnecting client with same geometry received nothing within 2.0s")

                assert not isinstance(first_chunk, Exception), first_chunk
                assert not first_chunk.startswith(b"\x1b[2J"), (
                    "no clear sequence must be sent when geometry is unchanged; "
                    f"got: {first_chunk!r}"
                )
                assert first_chunk == expected_snapshot


class MockWebSocket:
    def __init__(self, messages):
        self.messages = messages
        self.sent_bytes = []
        # Bug 2 fix: resume_failed is sent via websocket.send_text() as a JSON
        # control frame (see pty_endpoint) — captured separately from
        # sent_bytes (raw PTY output) so tests can assert on it without
        # parsing/guessing which list a given payload landed in.
        self.sent_text = []
        self.closed_code = None
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def receive(self):
        if not self.messages:
            # Block indefinitely to simulate open connection
            await asyncio.Event().wait()
        return self.messages.pop(0)

    async def send_bytes(self, data):
        self.sent_bytes.append(data)

    async def send_text(self, data):
        self.sent_text.append(data)

    async def close(self, code=1000, reason=None):
        self.closed_code = code


@pytest.mark.asyncio
async def test_pty_websocket_single_reader_eviction(client):
    """Connecting a second WebSocket reader on the same session key evicts the first one."""
    from app.main import pty_endpoint, _active_connections, _active_tasks

    # Clear any active connections/tasks left from other tests
    _active_connections.clear()
    _active_tasks.clear()

    ws1 = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24
        })}
    ])

    ws2 = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24
        })}
    ])

    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            # Start ws1 handler
            task1 = asyncio.create_task(pty_endpoint(ws1, "evict-test"))
            await asyncio.sleep(0.1) # Let task1 run and initialize

            assert "evict-test" in _active_connections
            assert _active_connections["evict-test"] is ws1

            # Start ws2 handler, which should evict ws1
            task2 = asyncio.create_task(pty_endpoint(ws2, "evict-test"))
            await asyncio.sleep(0.1) # Let eviction run

            # Assert ws1 was closed and task1 terminated
            assert ws1.closed_code == 1008
            assert task1.done()

            # Clean up ws2
            task2.cancel()
            try:
                await task2
            except asyncio.CancelledError:
                pass


class ClosingWebSocket(MockWebSocket):
    """A WebSocket whose send_bytes always raises the exact RuntimeError
    Starlette raises when sending on an already-closed (evicted) socket."""

    async def send_bytes(self, data):
        raise RuntimeError('Cannot call "send" once a close message has been sent.')


@pytest.mark.asyncio
async def test_pty_websocket_send_after_close_does_not_crash_task(client):
    """A send racing an eviction-close (RuntimeError from send_bytes) must not
    leave pty_to_ws()'s enclosing task with an unhandled exception."""
    from app.main import pty_endpoint, _active_connections, _active_tasks

    _active_connections.clear()
    _active_tasks.clear()

    ws = ClosingWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24
        })},
        {"type": "websocket.disconnect", "code": 1000},
    ])

    fake_cmd = [sys.executable, "-c", "print('hi'); import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "send-race-test"))
            await asyncio.sleep(0.5)

            assert task.done()
            assert task.exception() is None


@pytest.mark.asyncio
async def test_pty_websocket_resume_fallback_on_invalid_session_id():
    """Bug 2 fix: when --resume fails (error output in stdout), the backend
    must NOT auto-respawn a fresh session anymore. It leaves the old
    claude_session_id untouched in the store and sends a `resume_failed`
    control frame instead, so the frontend can show the "Iniciar nova
    conversa" overlay and let the user confirm explicitly via
    POST /api/sessions/{key}/reset. Regression coverage for the old
    respawn-automatically behavior this replaces."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()

    # Pre-populate store with a session ID to trigger --resume
    await store.set("fallback-test", "old-session-uuid")

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24
        })}
    ])

    # _build_pty_cmd is only ever invoked ONCE now (the initial --resume
    # attempt) — there is no second "fallback" spawn to mock a return value for.
    call_count = 0
    def mock_build_pty_cmd(session_id, resume, system_prompt, base_cmd=None):
        nonlocal call_count
        call_count += 1
        assert resume, "no second (resume=False) call should happen — no auto-respawn"
        return [sys.executable, "-c", "import sys; print('No conversation found with session ID: ' + sys.argv[1]); sys.exit(1)", session_id]

    with patch("app.main._build_pty_cmd", side_effect=mock_build_pty_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "fallback-test"))
            await asyncio.sleep(0.9)  # Wait for probe to detect the failure

            # Only the resume attempt happened — no fallback respawn.
            assert call_count == 1

            # The store must still hold the OLD claude_session_id: no silent
            # clear-and-recreate.
            sid = await store.get("fallback-test")
            assert sid == "old-session-uuid"

            # A resume_failed control frame was sent to the client instead.
            assert len(ws.sent_text) == 1
            frame = json.loads(ws.sent_text[0])
            assert frame == {"type": "resume_failed", "session_key": "fallback-test"}

            # Cleanup
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


@pytest.mark.asyncio
async def test_pty_websocket_spawn_failure_sends_control_frame_and_stays_open():
    """.planning/debug/claude-work-ws-reconnect-loop.md: when the agent's
    configured `cmd` can't be spawned at all (cmd[0] isn't a real executable
    on PATH — e.g. it names a shell alias/function like the real-world
    'claude-work' case, which subprocess.Popen without shell=True can never
    resolve), the resulting FileNotFoundError must NOT escape as an unhandled
    exception. Left uncaught, that would abort the just-accepted WS, and the
    frontend's onclose reconnects unconditionally on any non-1008 close —
    resending the same InitFrame, hitting this exact same spawn failure
    again, forever (the reported reconnect-storm "piscando" loop). Instead,
    the backend must send a `spawn_failed` control frame (same shape as
    resume_failed) and keep the socket open/idling, so the frontend never
    sees a close event and therefore never reconnects."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24,
        })},
    ])

    with patch("app.main._build_pty_cmd", return_value=["definitely-not-a-real-binary-xyz"]):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "spawn-fail-test"))
            await asyncio.sleep(0.3)

            # The handler must still be running (idling on receive()), not
            # crashed and not closed the connection.
            assert not task.done(), "pty_endpoint must stay alive, not crash the WS, on a spawn failure"
            assert ws.closed_code is None

            assert len(ws.sent_text) == 1
            frame = json.loads(ws.sent_text[0])
            assert frame["type"] == "spawn_failed"
            assert frame["session_key"] == "spawn-fail-test"
            assert "definitely-not-a-real-binary-xyz" in frame["detail"]

            # Cleanup
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


@pytest.mark.asyncio
async def test_pty_websocket_resume_fallback_survives_delayed_error_and_output_gaps():
    """Regression test: the resume-failure probe must not give up just because
    the failing process is slow to start or has a quiet gap (>200ms) before
    printing its error — that exact pattern (a fixed 0.2s per-read timeout
    breaking the whole probe on the first gap, combined with an 0.8s total
    budget) previously caused the probe to miss real-world Claude CLI resume
    failures under normal/loaded timing, leaving the error frozen on screen
    with no recovery ("chat não encontrado" reports).

    Bug 2 fix updates the OUTCOME once detected: no auto-respawn anymore —
    the store keeps the old (bad) claude_session_id and the client gets a
    resume_failed control frame, same as the non-delayed case above."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()

    await store.set("slow-fallback-test", "old-session-uuid")

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24
        })}
    ])

    call_count = 0
    def mock_build_pty_cmd(session_id, resume, system_prompt, base_cmd=None):
        nonlocal call_count
        call_count += 1
        assert resume, "no second (resume=False) call should happen — no auto-respawn"
        # Simulate slow startup: a >1.5s gap (well past the old 0.2s
        # per-read timeout and 0.8s total budget) before the error prints.
        return [sys.executable, "-c",
                "import time, sys; time.sleep(1.5); "
                "print('No conversation found with session ID: ' + sys.argv[1]); "
                "sys.exit(1)", session_id]

    with patch("app.main._build_pty_cmd", side_effect=mock_build_pty_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "slow-fallback-test"))
            await asyncio.sleep(3.0)  # past the delayed error, within the new 5s deadline

            assert call_count == 1, "the delayed error must still be detected without a second (fallback) spawn"

            sid = await store.get("slow-fallback-test")
            assert sid == "old-session-uuid"

            assert len(ws.sent_text) == 1
            frame = json.loads(ws.sent_text[0])
            assert frame == {"type": "resume_failed", "session_key": "slow-fallback-test"}

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


class TypingDuringResumeFailedWebSocket(MockWebSocket):
    """Delivers its 2nd message (simulating a user keystroke) only once the
    given PTYProcess is confirmed fully dead (proc.active is False). This
    removes the race present in a same-tick delivery: in real usage the
    keystroke always arrives well after the resume_failed control frame
    reaches the browser (network round-trip + human reaction time), by which
    point the child process has long since exited and torn down its PTY."""

    def __init__(self, messages, proc_getter):
        super().__init__(messages)
        self._proc_getter = proc_getter
        self._served_first = False

    async def receive(self):
        if self._served_first:
            for _ in range(300):  # bounded ~3s poll
                proc = self._proc_getter()
                if proc is not None and not proc.active:
                    break
                await asyncio.sleep(0.01)
        self._served_first = True
        return await super().receive()


@pytest.mark.asyncio
async def test_typing_after_resume_failed_does_not_crash_task():
    from app.main import pty_endpoint, store, _active_connections, _active_tasks, pty_manager

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()
    await store.set("typing-after-resume-failed-test", "old-session-uuid")

    ws = TypingDuringResumeFailedWebSocket(
        [
            {"type": "websocket.receive", "text": json.dumps({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })},
            {"type": "websocket.receive", "bytes": b"x"},
            {"type": "websocket.disconnect", "code": 1000},
        ],
        proc_getter=lambda: pty_manager.get("typing-after-resume-failed-test"),
    )

    fake_cmd = [
        sys.executable, "-c",
        "import sys; print('No conversation found with session ID: ' + sys.argv[1]); sys.exit(1)",
    ]

    def mock_build_pty_cmd(session_id, resume, system_prompt, base_cmd=None):
        return fake_cmd + [session_id]

    with patch("app.main._build_pty_cmd", side_effect=mock_build_pty_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, "typing-after-resume-failed-test"))
            try:
                await asyncio.sleep(2.0)

                assert task.done()
                exc = task.exception()
                assert exc is None, f"pty_endpoint task crashed with unhandled exception: {exc!r}"
            finally:
                # Must run even on the xfail path (the assert above is what
                # produces the xfail) — otherwise the global `store`'s
                # aiosqlite connection/thread leaks past this test and hangs
                # interpreter shutdown at the end of the full suite run.
                #
                # task.cancel() is a no-op on an already-done task — and on
                # the xfail path the task IS already done, holding the
                # RuntimeError('PTY closed') itself. Awaiting an
                # already-done task re-raises whatever it holds (that
                # RuntimeError, not CancelledError), so a narrow
                # `except asyncio.CancelledError` here does NOT catch it and
                # `store.close()` below would be skipped again. Catch
                # broadly — cleanup doesn't care why the task ended.
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass
                await store.close()


@pytest.mark.asyncio
async def test_pty_websocket_disconnect_before_init_does_not_raise_keyerror():
    """If the client disconnects before sending the init frame, the backend should return cleanly without raising KeyError."""
    from app.main import pty_endpoint, _active_connections, _active_tasks

    _active_connections.clear()
    _active_tasks.clear()

    # Create a mock WebSocket that sends a disconnect message instead of init
    ws = MockWebSocket([
        {"type": "websocket.disconnect", "code": 1001}
    ])

    # This should return cleanly (not raise KeyError or other exception)
    await pty_endpoint(ws, "disconnect-test")


def test_terminate_endpoint_404_for_unknown_session(client):
    """POST /api/sessions/{key}/terminate returns 404 for an unknown session_key."""
    r = client.post("/api/sessions/nonexistent-project::agent/terminate")
    assert r.status_code == 404
    body = r.json()
    assert "detail" in body


def test_terminate_endpoint_handles_slash_in_key(client):
    """POST /api/sessions/{key}/terminate correctly routes session keys containing '/'."""
    # A key that doesn't exist — should get 404, not a routing error (404 from /:path mismatch)
    r = client.post("/api/sessions/pessoal/meu-projeto::claude/terminate")
    assert r.status_code == 404  # 404 from our guard, not a routing 404


def test_reset_endpoint_404_for_unknown_session(client):
    """POST /api/sessions/{key}/reset returns 404 for an unknown session_key,
    same guard pattern as /terminate."""
    r = client.post("/api/sessions/nonexistent-project::agent/reset")
    assert r.status_code == 404
    body = r.json()
    assert "detail" in body


def test_reset_endpoint_success_preserves_display_name_and_clears_pty(client):
    """Bug 2 fix: POST /api/sessions/{key}/reset returns 200, terminates any
    live PTY, and preserves display_name — unlike /terminate, which deletes
    the whole row. Sets up the session via a real (faked-cmd) PTY spawn, same
    technique as test_rename_endpoint_sets_display_name (the store's aiosqlite
    connection lives on the TestClient's own event loop, not this sync test's)."""
    import app.main as main_mod

    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/reset-test") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time; time.sleep(0.2)

    r = client.patch("/api/sessions/reset-test/rename", json={"display_name": "Meu Chat"})
    assert r.status_code == 200

    assert main_mod.pty_manager.get("reset-test") is not None

    r2 = client.post("/api/sessions/reset-test/reset")
    assert r2.status_code == 200
    body = r2.json()
    assert body == {"status": "reset", "session_key": "reset-test"}

    # PTY was terminated as part of the reset.
    assert main_mod.pty_manager.get("reset-test") is None

    # display_name (and, implicitly, needs_attention) survive — unlike /terminate.
    meta = client.get("/api/sessions/persisted").json()
    assert "reset-test" in meta
    assert meta["reset-test"]["display_name"] == "Meu Chat"


def test_reset_endpoint_idempotent_on_double_call(client):
    """Edge case (TL-flagged): a double-click on 'Iniciar nova conversa' fires
    the POST twice. The second call must not error — the session is still
    known to the store (reset only blanks claude_session_id, it never
    deletes the row), so it must return 200 again, not 404."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/reset-double-test") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time; time.sleep(0.2)

    r1 = client.post("/api/sessions/reset-double-test/reset")
    assert r1.status_code == 200

    r2 = client.post("/api/sessions/reset-double-test/reset")
    assert r2.status_code == 200


def test_rename_endpoint_sets_display_name(client):
    """PATCH /api/sessions/{key}/rename persists the custom name (D-08). Sets
    up the persisted row via a real (faked-cmd) PTY spawn — same technique as
    test_terminate_endpoint_success_on_active_session — instead of touching
    ConversationStore directly, since its aiosqlite connection lives on the
    TestClient's own event loop, not this (sync) test function's."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/rename-test") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            import time; time.sleep(0.2)

    r = client.patch("/api/sessions/rename-test/rename", json={"display_name": "Meu Chat"})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Meu Chat"

    meta = client.get("/api/sessions/persisted").json()
    assert meta["rename-test"]["display_name"] == "Meu Chat"


def test_rename_endpoint_rejects_empty_name(client):
    """D-09: nome vazio é rejeitado com 400, sem gravar nada."""
    r = client.patch("/api/sessions/rename-test/rename", json={"display_name": ""})
    assert r.status_code == 400


def test_rename_endpoint_rejects_whitespace_only_name(client):
    """D-09: nome só com espaços também é rejeitado com 400."""
    r = client.patch("/api/sessions/rename-test/rename", json={"display_name": "   "})
    assert r.status_code == 400


def test_rename_endpoint_handles_slash_in_key(client):
    """Session keys with '/' (sub-project paths) route correctly to /rename."""
    r = client.patch("/api/sessions/pessoal/meu-projeto::claude/rename", json={"display_name": "X"})
    assert r.status_code == 200


def test_hook_stop_marks_needs_attention_for_known_session(client):
    """POST /api/hooks/stop resolves the CLI session_id back to our session_key
    and marks needs_attention — this is the real ADR-02-revisado trigger,
    replacing the running->idle heuristic that never fired in practice.
    Pins uuid.uuid4() so the test knows exactly which claude session_id the
    spawn will register in the store, for the same event-loop reason noted
    on test_rename_endpoint_sets_display_name above."""
    import uuid as uuid_mod
    fixed_uuid = uuid_mod.UUID("11111111-1111-1111-1111-111111111111")
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=fixed_uuid):
            with client.websocket_connect("/ws/pty/hook-test") as ws:
                ws.send_json({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                import time; time.sleep(0.2)

    r = client.post("/api/hooks/stop", json={"session_id": str(fixed_uuid)})
    assert r.status_code == 200

    meta = client.get("/api/sessions/persisted").json()
    assert meta["hook-test"]["needs_attention"] is True


def test_hook_stop_unknown_session_id_is_noop(client):
    """A session_id not in our store must not error — just no-op 200."""
    r = client.post("/api/hooks/stop", json={"session_id": "unknown-uuid"})
    assert r.status_code == 200


def test_hook_stop_missing_session_id_does_not_crash(client):
    """Malformed/partial hook payload (no session_id) must not 500."""
    r = client.post("/api/hooks/stop", json={})
    assert r.status_code == 200


def test_build_pty_cmd_includes_stop_hook_settings():
    """_build_pty_cmd must always inject --settings with the Stop hook (ADR-02
    revisado) — this is what makes needs_attention detection work at all."""
    from app.main import _build_pty_cmd

    cmd = _build_pty_cmd("sid-1", resume=False, system_prompt=None)
    assert "--settings" in cmd
    settings_json = cmd[cmd.index("--settings") + 1]
    assert "hooks/stop" in settings_json
    assert '"Stop"' in settings_json


def test_build_pty_cmd_never_includes_dangerously_skip_permissions():
    """Claude spawns must no longer bypass the permission system — the flag
    was removed so real permission/tool-approval prompts surface instead of
    being silently skipped. Covers both fresh and --resume invocations."""
    from app.main import _build_pty_cmd

    fresh = _build_pty_cmd("sid-1", resume=False, system_prompt=None)
    resumed = _build_pty_cmd("sid-1", resume=True, system_prompt=None)
    assert "--dangerously-skip-permissions" not in fresh
    assert "--dangerously-skip-permissions" not in resumed


def test_terminate_endpoint_success_on_active_session(client):
    """POST /api/sessions/{key}/terminate returns 200 and terminates the PTY for a known session."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with client.websocket_connect("/ws/pty/test-proj::claude") as ws:
            ws.send_json({
                "type": "init",
                "project_id": "meu-projeto",
                "agent_id": None,
                "cols": 80,
                "rows": 24,
            })
            # Let the process start
            import time; time.sleep(0.2)

            # Session should now exist in the manager
            import app.main as main_mod
            assert main_mod.pty_manager.get("test-proj::claude") is not None

            r = client.post("/api/sessions/test-proj::claude/terminate")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "terminated"
            assert body["session_key"] == "test-proj::claude"

            # Process should be gone from manager
            assert main_mod.pty_manager.get("test-proj::claude") is None


# ==========================================================================
# ia="cursor" — contrato de argv, provisionamento do chat e probe de retomada
# ==========================================================================

def _cursor_agent(cmd=None):
    from app.models import Agent
    return Agent(
        id="cursor", nome="Cursor", papel="Assistente", ia="cursor",
        cmd=cmd or ["cursor-agent"],
    )


def test_build_agent_cmd_uses_trust_and_resume_for_cursor_agent():
    """Contrato de argv do Cursor: o cmd do cadastro + --trust + --resume <id>,
    com o --resume por ULTIMO. A posição importa: no Cursor o parâmetro é
    OPCIONAL (`--resume [chatId]`), então uma flag colada depois poderia ser
    lida como o valor, deixando o --resume efetivamente nu — e --resume nu abre
    o seletor interativo, que travaria o PTY numa TUI sem saída pela UI."""
    from app.main import _build_agent_cmd

    cmd = _build_agent_cmd(_cursor_agent(), "chat-id-1", resume=False, system_prompt=None)

    assert cmd == ["cursor-agent", "--trust", "--resume", "chat-id-1"]
    assert cmd[-2:] == ["--resume", "chat-id-1"], "--resume <id> tem que ser o final do argv"


def test_build_agent_cmd_always_resumes_cursor_even_on_a_fresh_session():
    """Para o Cursor o id não é inventado por nós, é emitido pelo `create-chat`
    ANTES deste ponto (session_provisioner) — quando chegamos aqui o chat já
    existe dos dois lados, mesmo numa "sessão nova". Logo o argv usa --resume
    nos dois casos, e o parâmetro `resume` (que significa "o id já existia antes
    desta chamada", e é o que decide se o probe roda) é ignorado neste ramo."""
    from app.main import _build_agent_cmd

    fresh = _build_agent_cmd(_cursor_agent(), "chat-id-1", resume=False, system_prompt=None)
    resumed = _build_agent_cmd(_cursor_agent(), "chat-id-1", resume=True, system_prompt=None)

    assert fresh == resumed


def test_build_agent_cmd_preserves_registered_cursor_flags():
    """O cmd do cadastro é preservado inteiro — é por ali que o Bruno passa
    caminho absoluto do binário (não está no PATH do backend) e overrides como
    --model ou --force, sem precisar de mudança de código."""
    from app.main import _build_agent_cmd

    agent = _cursor_agent(cmd=["C:/tools/cursor-agent.exe", "--model", "sonnet"])
    cmd = _build_agent_cmd(agent, "chat-id-1", resume=False, system_prompt=None)

    assert cmd == ["C:/tools/cursor-agent.exe", "--model", "sonnet",
                   "--trust", "--resume", "chat-id-1"]


def test_build_agent_cmd_omits_yolo_and_claude_only_flags_for_cursor():
    """Nem os flags de auto-aprovação (--yolo/--force não entram por código: o
    override é manual, via cmd do cadastro), nem nada do contrato do claude
    (--session-id, --settings, --mcp-config) ou do ramo genérico
    (--dangerously-skip-permissions) — o Cursor não conhece nenhum deles."""
    from app.main import _build_agent_cmd

    cmd = _build_agent_cmd(_cursor_agent(), "chat-id-1", resume=False, system_prompt=None)

    for flag in ("--yolo", "--force", "--session-id", "--settings",
                 "--mcp-config", "--dangerously-skip-permissions"):
        assert flag not in cmd


def test_build_agent_cmd_ignores_system_prompt_for_cursor_agent():
    """O Cursor não tem --append-system-prompt, e um --prompt posicional
    CONSUMIRIA o turno (o agente responderia ao system prompt em vez de esperar o
    usuário). Mesmo tratamento do ramo "terminal"; o caminho do Cursor para
    instruções persistentes é .cursor/rules, fora do escopo."""
    from app.main import _build_agent_cmd

    cmd = _build_agent_cmd(
        _cursor_agent(), "chat-id-1", resume=False, system_prompt="Voce e o agente X",
    )

    assert "Voce e o agente X" not in cmd
    assert "--prompt-interactive" not in cmd
    assert "--append-system-prompt" not in cmd
    assert cmd == ["cursor-agent", "--trust", "--resume", "chat-id-1"]


def test_resume_failure_signatures_preserve_claude_behavior_exactly():
    """O registry generalizou o probe, mas o claude tem que continuar byte a byte
    idêntico: mesma string, e morrer NÃO conta como falha (para ele o que decide
    é a mensagem, não o exit). Mudar isso seria alterar semântica testada do
    claude numa rodada que não é sobre o claude."""
    from app.main import _RESUME_FAILURE_SIGNATURES

    claude = _RESUME_FAILURE_SIGNATURES["claude"]
    assert claude["markers"] == (b"No conversation found with session ID",)
    assert claude["exit_is_failure"] is False


def test_resume_failure_signatures_cursor_falls_back_to_exit_code():
    """A saída real de `cursor-agent --resume <id-inexistente>` é uma incógnita
    empírica, então `markers` está vazio de propósito — e a feature funciona
    assim mesmo, porque `exit_is_failure` cobre o caso (o processo morre). Quando
    a string aparecer, acrescentá-la só torna a detecção mais rápida."""
    from app.main import _RESUME_FAILURE_SIGNATURES

    cursor = _RESUME_FAILURE_SIGNATURES["cursor"]
    assert cursor["exit_is_failure"] is True
    assert isinstance(cursor["markers"], tuple)


def test_agent_types_with_continue_resume_have_no_probe():
    """antigravity/gemini/agy resume via `--continue` ("most recent
    conversation"), not an explicit id — verified experimentally
    (2026-08-26) that this never produces failure text: with zero prior
    conversations agy just starts a fresh one silently. There being no
    string to ever key a probe on means these three must have NO entry in
    the registry at all (like "terminal") rather than an entry with empty
    markers: a present-but-empty dict is still truthy, so the caller (see
    `if resume and signature:` in pty_endpoint) would run the up-to-5s probe
    loop for nothing, blocking the user's input the whole time for zero
    detection benefit."""
    from app.main import _RESUME_FAILURE_SIGNATURES

    for ia in ("antigravity", "gemini", "agy"):
        assert ia not in _RESUME_FAILURE_SIGNATURES


def test_agent_types_without_resume_semantics_have_no_probe():
    """terminal is a raw shell with no session/resume concept at all (see
    _build_agent_cmd's ia="terminal" branch, which returns agent.cmd
    unmodified) — so it correctly has no entry in the registry, there's no
    "failed resume" to ever detect for it."""
    from app.main import _RESUME_FAILURE_SIGNATURES

    assert "terminal" not in _RESUME_FAILURE_SIGNATURES


@pytest.mark.asyncio
async def test_provisioning_failure_sends_spawn_failed_and_keeps_socket_open():
    """Uma falha de `cursor-agent create-chat` acontece ANTES do spawn e ANTES do
    store.set — nada fica meio-criado. Ela chega como SessionProvisioningError,
    que É OSError e portanto cai no catch anti-reconnect-storm que já existia:
    frame de controle no socket AINDA ABERTO, handler seguindo no loop de
    receive(). Fechar o socket aqui reabriria o storm (o frontend não distingue o
    close de um blip de rede, reconecta, reenvia o InitFrame, falha igual)."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks
    from app.session_provisioner import SessionProvisioningError
    import uuid as uuid_mod

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()
    # R4: session_key única por teste. `_session_locks` é dict global de módulo e
    # sobrevive entre testes do mesmo processo pytest — reusar uma chave de outro
    # teste importaria o lock dele.
    session_key = f"cursor-provision-fail-{uuid_mod.uuid4().hex[:8]}"

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24,
        })},
    ])

    detail = ("Nao foi possivel criar um chat no Cursor: tempo esgotado apos 10s. "
              "Verifique se 'cursor-agent' esta instalado e autenticado.")

    with patch("app.main.provision_session_id", new_callable=AsyncMock,
               side_effect=SessionProvisioningError(detail)):
        with patch("app.main._resolve_agent", return_value=(None, _cursor_agent(), ".")):
            task = asyncio.create_task(pty_endpoint(ws, session_key))
            await asyncio.sleep(0.3)

            assert not task.done(), "pty_endpoint tem que continuar vivo (ocioso em receive())"
            assert ws.closed_code is None, "fechar o socket para reportar falha reabre o storm"

            assert len(ws.sent_text) == 1
            frame = json.loads(ws.sent_text[0])
            assert frame["type"] == "spawn_failed"
            assert frame["session_key"] == session_key
            # A mensagem é renderizada no terminal do usuário — precisa chegar
            # inteira, não como um "OSError" genérico.
            assert "Nao foi possivel criar um chat no Cursor" in frame["detail"]

            # Nada meio-criado: sem id no store, então a próxima tentativa cai
            # limpa no fluxo de sessão nova.
            assert not await store.get(session_key)

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


@pytest.mark.asyncio
async def test_concurrent_ensure_pty_on_same_key_provisions_only_once():
    """ADR-C5: `_ensure_pty` serializado por session_key.

    Três caminhos chamam _ensure_pty na mesma chave (pty_endpoint,
    POST .../continue, POST .../paste). Enquanto o id de sessão era um uuid4
    local, a janela entre store.get e store.set era de microssegundos; com o
    Cursor ela contém um subprocess de vários segundos. Sem o lock, dois callers
    concorrentes rodam `create-chat` DUAS vezes, o segundo pty_manager.spawn mata
    o PTY do primeiro (spawn() chama terminate() antes de criar) e sobra um chat
    órfão que o CLI não oferece como apagar.

    A checagem `proc and proc.active` precisa estar DENTRO do lock
    (double-checked locking) — só o lock não bastaria, o segundo caller ainda
    spawnaria em cima do primeiro."""
    from app.main import _ensure_pty, store, pty_manager
    import uuid as uuid_mod

    await store.initialize()
    session_key = f"cursor-race-{uuid_mod.uuid4().hex[:8]}"

    provision_calls = []

    async def slow_provision(agent, cwd, existing_id):
        if existing_id:
            return existing_id
        provision_calls.append(cwd)
        # Simula a latência real do `create-chat` (chamada de rede): é essa
        # janela que o lock precisa cobrir.
        await asyncio.sleep(0.2)
        return f"chat-{len(provision_calls)}"

    live_procs = {}

    def fake_spawn(key, cmd, **kwargs):
        proc = MagicMock()
        proc.active = True
        live_procs[key] = proc
        return proc

    with patch("app.main.provision_session_id", side_effect=slow_provision):
        with patch("app.main._resolve_agent", return_value=(None, _cursor_agent(), ".")):
            with patch.object(pty_manager, "spawn", side_effect=fake_spawn):
                with patch.object(pty_manager, "get", side_effect=live_procs.get):
                    results = await asyncio.gather(
                        _ensure_pty(session_key, "meu-projeto", None),
                        _ensure_pty(session_key, "meu-projeto", None),
                    )

    assert len(provision_calls) == 1, (
        f"create-chat rodou {len(provision_calls)}x — cada chamada extra é um chat órfão"
    )
    # O segundo caller reaproveitou o PTY do primeiro em vez de spawnar em cima.
    spawned_flags = sorted(spawned for _, spawned, _, _ in results)
    assert spawned_flags == [False, True]
    assert await store.get(session_key) == "chat-1"

    await store.close()


@pytest.mark.asyncio
async def test_existing_chat_id_never_triggers_a_second_create_chat():
    """Reconexão / cold resume: com id já no store o provisioner devolve o valor
    existente sem I/O, e o `resume=True` retornado é o que liga o probe."""
    from app.main import _ensure_pty, store, pty_manager
    import uuid as uuid_mod

    await store.initialize()
    session_key = f"cursor-reconnect-{uuid_mod.uuid4().hex[:8]}"
    await store.set(session_key, "chat-ja-existente")

    captured = {}

    def fake_spawn(key, cmd, **kwargs):
        captured["cmd"] = cmd
        proc = MagicMock()
        proc.active = True
        return proc

    with patch("app.main._resolve_agent", return_value=(None, _cursor_agent(), ".")):
        with patch.object(pty_manager, "spawn", side_effect=fake_spawn):
            with patch.object(pty_manager, "get", return_value=None):
                with patch("app.session_provisioner.run_capture",
                           new_callable=AsyncMock) as runner:
                    _proc, spawned, resume, _agent = await _ensure_pty(
                        session_key, "meu-projeto", None,
                    )

    runner.assert_not_called()
    assert spawned is True
    assert resume is True, "resume=True é o que liga o probe de resume-failure"
    assert captured["cmd"][-2:] == ["--resume", "chat-ja-existente"]
    assert await store.get(session_key) == "chat-ja-existente"

    await store.close()


@pytest.mark.asyncio
async def test_cursor_process_dying_during_probe_sends_resume_failed():
    """`exit_is_failure=True`: sem a string de erro do Cursor (incógnita
    empírica), o sinal disponível é o processo MORRER dentro da janela do probe.
    Os bytes que ele imprimiu antes de morrer são encaminhados ao cliente ANTES
    do frame — é isso que faz o falso positivo aceitável: o usuário vê a
    mensagem real de erro e recebe o overlay de "Iniciar nova conversa"."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks
    import uuid as uuid_mod

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()
    session_key = f"cursor-resume-fail-{uuid_mod.uuid4().hex[:8]}"
    await store.set(session_key, "chat-que-nao-existe-mais")

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24,
        })},
    ])

    dying_cmd = [sys.executable, "-c", "print('Error: chat not found'); raise SystemExit(1)"]

    with patch("app.main._build_agent_cmd", return_value=dying_cmd):
        with patch("app.main._resolve_agent", return_value=(None, _cursor_agent(), ".")):
            task = asyncio.create_task(pty_endpoint(ws, session_key))
            await asyncio.sleep(1.5)

            assert len(ws.sent_text) == 1, f"esperado 1 frame de controle, veio {ws.sent_text}"
            frame = json.loads(ws.sent_text[0])
            assert frame == {"type": "resume_failed", "session_key": session_key}

            # A saída do processo foi encaminhada antes do frame — o usuário vê o
            # erro real, não só o overlay.
            assert b"chat not found" in b"".join(ws.sent_bytes)

            # Sem recriação automática: o id velho fica no store até um
            # POST /reset explícito do usuário.
            assert await store.get(session_key) == "chat-que-nao-existe-mais"

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


@pytest.mark.asyncio
async def test_claude_process_dying_during_probe_does_not_send_resume_failed():
    """A contraprova do teste acima: `exit_is_failure=False` no claude. Um
    processo claude que morre sem imprimir a mensagem conhecida NÃO pode virar
    resume_failed — é o comportamento pré-existente, e mudá-lo transformaria
    qualquer crash de startup do claude num falso "chat não encontrado"."""
    from app.main import pty_endpoint, store, _active_connections, _active_tasks
    import uuid as uuid_mod

    await store.initialize()
    _active_connections.clear()
    _active_tasks.clear()
    session_key = f"claude-dies-{uuid_mod.uuid4().hex[:8]}"
    await store.set(session_key, "sid-antigo")

    ws = MockWebSocket([
        {"type": "websocket.receive", "text": json.dumps({
            "type": "init", "project_id": "meu-projeto", "agent_id": None,
            "cols": 80, "rows": 24,
        })},
    ])

    dying_cmd = [sys.executable, "-c", "print('algum outro erro'); raise SystemExit(1)"]

    with patch("app.main._build_agent_cmd", return_value=dying_cmd):
        with patch("app.main._resolve_agent", return_value=(None, None, ".")):
            task = asyncio.create_task(pty_endpoint(ws, session_key))
            await asyncio.sleep(1.5)

            assert ws.sent_text == [], "morrer não é falha de retomada para o claude"

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await store.close()


def test_continue_endpoint_reports_provisioning_failure_without_5xx(client):
    """Lacuna fechada pela T9: `continue_session` capturava só LookupError,
    enquanto o docstring dela promete explicitamente nunca devolver 4xx/5xx.
    Nenhum tipo de agente anterior levantava exceção ANTES do spawn, então isso
    nunca foi exposto — o provisionamento do id do Cursor expõe. Uma
    SessionProvisioningError não tratada aqui viraria um 500 do FastAPI.

    A session_key não leva sufixo "::<agent_id>" de propósito: um agent_id
    explícito não resolvível dispararia o LookupError do guard de _ensure_pty
    ANTES do provisionamento, e o teste passaria por "no_agent" sem nunca
    exercitar o ramo novo."""
    from app.session_provisioner import SessionProvisioningError

    with patch("app.main.provision_session_id", new_callable=AsyncMock,
               side_effect=SessionProvisioningError("Falha ao criar chat no Cursor.")):
        r = client.post("/api/sessions/meu-projeto/continue")

    assert r.status_code == 200, "o contrato é nunca 4xx/5xx, nem quando o CLI falha"
    body = r.json()
    # Status próprio, distinto de "no_agent": os dois são "não deu, e não é culpa
    # sua", mas a causa é diferente (agente inexistente vs. CLI do agente falhou).
    assert body["status"] == "provisioning_failed"
    assert "Cursor" in body["detail"]


def test_paste_endpoint_reports_provisioning_failure_without_5xx(client):
    """Espelha continue_session — mesma resolução via _ensure_pty, mesma promessa
    de nunca 4xx/5xx, mesma lacuna."""
    from app.session_provisioner import SessionProvisioningError

    with patch("app.main.provision_session_id", new_callable=AsyncMock,
               side_effect=SessionProvisioningError("Falha ao criar chat no Cursor.")):
        r = client.post("/api/sessions/meu-projeto/paste", json={"text": "algo"})

    assert r.status_code == 200
    assert r.json()["status"] == "provisioning_failed"


# ==========================================================================
# Bordas acrescentadas pelo QA — lock e caminho de sessão nova do Cursor
# ==========================================================================

@pytest.mark.asyncio
async def test_session_lock_is_released_when_provisioning_raises():
    """A `_ensure_pty` lock must survive a provisioning failure.

    ADR-C5 wraps the whole body of `_ensure_pty` in `async with
    _session_lock(session_key)`, and `_session_locks` is a module-level dict that
    outlives any single request. If the lock ever leaked on the exception path,
    EVERY later call for that session_key would block forever: the user's tab
    would hang with no output and no `spawn_failed`, and only a backend restart
    would clear it. That is strictly worse than the reconnect storm the catch was
    written to prevent, because there is no frame telling the frontend anything.

    `async with` releases on exception, so this is a regression guard, not a
    suspected bug. It is worth owning explicitly because the failing branch is
    now reachable (the Cursor provisioner does pre-spawn I/O that can raise) and
    a future refactor to a manual `acquire()`/`release()` would break it
    silently — every other test only exercises the failure once.
    """
    from app.main import _ensure_pty, store, pty_manager, _session_locks, _session_lock_users
    from app.session_provisioner import SessionProvisioningError
    import uuid as uuid_mod

    await store.initialize()
    # R4: unique session_key per test — `_session_locks` is a module global that
    # survives across tests in the same pytest process.
    session_key = f"cursor-lock-release-{uuid_mod.uuid4().hex[:8]}"
    chat_id = "8a5b9c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d"

    calls = []

    async def failing_then_ok(agent, cwd, existing_id):
        if existing_id:
            return existing_id
        calls.append(len(calls))
        if len(calls) == 1:
            raise SessionProvisioningError("create-chat falhou na primeira vez.")
        return chat_id

    def fake_spawn(key, cmd, **kwargs):
        proc = MagicMock()
        proc.active = True
        return proc

    with patch("app.main.provision_session_id", side_effect=failing_then_ok):
        with patch("app.main._resolve_agent", return_value=(None, _cursor_agent(), ".")):
            with patch.object(pty_manager, "spawn", side_effect=fake_spawn):
                with patch.object(pty_manager, "get", return_value=None):
                    with pytest.raises(SessionProvisioningError):
                        await _ensure_pty(session_key, "meu-projeto", None)

                    # Nothing is left holding the lock. Asserting on the dict
                    # state directly (rather than only on the retry) pins the
                    # actual invariant instead of a side effect of it.
                    #
                    # This used to assert `session_key in _session_locks`, i.e.
                    # the entry survived the failure. `_session_lock` now hands
                    # the entry back once its last user leaves, so the invariant
                    # is stated the other way round: the failing path must leave
                    # NOTHING behind — no refcount and no lock object. A leftover
                    # refcount would be worse than the old leak: the entry could
                    # then never be reclaimed at all.
                    assert session_key not in _session_lock_users, (
                        "refcount retido após falha de provisioning: a entrada do "
                        "lock nunca mais seria removida"
                    )
                    leftover = _session_locks.get(session_key)
                    assert leftover is None, (
                        "lock retido após falha de provisioning: se ele tiver "
                        "ficado adquirido, toda chamada seguinte nessa "
                        "session_key travaria para sempre"
                    )

                    # And the retry really does go through, without deadlocking.
                    # The timeout is the point of the assertion: without it a
                    # leaked lock would hang the whole pytest run instead of
                    # failing this test.
                    _proc, spawned, resume, _agent = await asyncio.wait_for(
                        _ensure_pty(session_key, "meu-projeto", None), timeout=5.0,
                    )

    assert spawned is True
    assert resume is False, "a primeira tentativa falhou antes do store.set, então o id não pré-existia"
    assert await store.get(session_key) == chat_id
    assert len(calls) == 2

    await store.close()


@pytest.mark.asyncio
async def test_fresh_cursor_session_spawns_with_the_chat_id_the_cli_emitted():
    """Happy path of a brand-new Cursor session, end to end through
    `_ensure_pty` with only `run_capture` mocked.

    Three things are asserted together because they only hold together:
    1. the argv the PTY receives ends with the chatId `create-chat` printed, so
       `--resume` never carries a placeholder or a locally invented uuid4;
    2. the value is a canonical UUID even though the fake CLI wrapped it in
       banner noise on both sides — the parser scans lines, it does not strip;
    3. `resume` comes back False, which is what keeps the resume-failure probe
       OFF for a chat that was just born. With `exit_is_failure=True` for cursor,
       a probe running here would report `resume_failed` for a chat that exists
       perfectly well the moment the process exits for any other reason.
    """
    from app.main import _ensure_pty, store, pty_manager
    from app.command_runner import CommandResult
    import uuid as uuid_mod

    await store.initialize()
    session_key = f"cursor-fresh-{uuid_mod.uuid4().hex[:8]}"
    chat_id = "1f2e3d4c-5b6a-4978-8695-0a1b2c3d4e5f"

    # Banner before AND a new-version notice after: CLIs print on both sides, and
    # a bare `stdout.strip()` would only ever survive one of the two.
    noisy_stdout = (
        "Cursor Agent CLI v1.4.2\n"
        "Connecting to workspace...\n"
        f"{chat_id}\n"
        "A new version (1.5.0) is available. Run cursor-agent upgrade.\n"
    )

    captured = {}

    def fake_spawn(key, cmd, **kwargs):
        captured["cmd"] = cmd
        proc = MagicMock()
        proc.active = True
        return proc

    with patch("app.session_provisioner.run_capture", new_callable=AsyncMock,
               return_value=CommandResult(exit_code=0, stdout=noisy_stdout, stderr="")) as runner:
        with patch("app.main._resolve_agent",
                   return_value=(None, _cursor_agent(cmd=["cursor-agent", "--model", "sonnet"]), ".")):
            with patch.object(pty_manager, "spawn", side_effect=fake_spawn):
                with patch.object(pty_manager, "get", return_value=None):
                    _proc, spawned, resume, _agent = await _ensure_pty(
                        session_key, "meu-projeto", None,
                    )

    assert runner.await_count == 1, "uma sessão nova roda create-chat exatamente uma vez"
    assert spawned is True
    assert resume is False, "chat recém-criado não pode ligar o probe de resume-failure"

    # Registered flags survive in the interactive argv (unlike create-chat's,
    # which deliberately drops them), and --resume stays last.
    assert captured["cmd"] == [
        "cursor-agent", "--model", "sonnet", "--trust", "--resume", chat_id,
    ]
    # Defence in depth against a bare/blank --resume, which would drop the PTY
    # into Cursor's interactive chat picker with no way out through the UI.
    assert uuid_mod.UUID(captured["cmd"][-1])
    assert await store.get(session_key) == chat_id

    await store.close()


# ==========================================================================
# `_session_locks` lifecycle — ADR-C5 serialization must survive reclamation
# ==========================================================================

async def _wait_until(predicate, timeout=2.0):
    """Yields to the event loop until `predicate()` is true.

    Polling instead of an Event because what is being awaited is a state
    transition INSIDE production code (a refcount bump, a coroutine reaching
    its critical section) that has no hook to signal from. The timeout is what
    turns "the lock was never released" into a failed assertion instead of a
    hung pytest run.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError(f"timed out after {timeout}s waiting for condition")
        await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_session_lock_entry_is_reclaimed_when_the_last_user_leaves():
    """`_session_locks` must not grow one `asyncio.Lock` per session_key seen,
    forever. Before `_session_lock`, `_get_lock` inserted and nothing ever
    removed — no cleanup path (terminate, reset, grace period) touched the dict.
    """
    from app.main import _ensure_pty, store, pty_manager, _session_locks, _session_lock_users
    import uuid as uuid_mod

    await store.initialize()
    session_key = f"lock-reclaim-{uuid_mod.uuid4().hex[:8]}"

    def fake_spawn(key, cmd, **kwargs):
        proc = MagicMock()
        proc.active = True
        return proc

    baseline = len(_session_locks)

    # Plain (non-Cursor) path on purpose: no agent, no subprocess, the session
    # id is a local uuid4. This test is about the dict, not about provisioning.
    with patch("app.main._resolve_agent", return_value=(None, None, ".")):
        with patch.object(pty_manager, "spawn", side_effect=fake_spawn):
            with patch.object(pty_manager, "get", return_value=None):
                await _ensure_pty(session_key, "meu-projeto", None)

    assert session_key not in _session_locks, "entrada do lock vazou apos a chamada"
    assert session_key not in _session_lock_users, "refcount vazou apos a chamada"
    assert len(_session_locks) == baseline, (
        "`_session_locks` cresceu depois de uma chamada que ja terminou — e o "
        "vazamento que esta correcao fecha"
    )

    await store.close()


@pytest.mark.asyncio
async def test_session_teardown_cannot_remove_a_lock_a_caller_is_using():
    """The reclamation must not reopen the race ADR-C5 closed.

    The naive fix for the leak is a `_session_locks.pop(session_key)` in
    `terminate_session` / `reset_session` / the grace-period cleanup. It is
    wrong, and this is the sequence that breaks it:

      1. caller A takes the Lock instance L1 out of the dict (not acquired yet)
      2. teardown pops the key -> L1 is no longer reachable from the dict
      3. A acquires L1 and enters `_ensure_pty_locked`
      4. caller B finds no entry, creates L2, acquires L2 immediately
      5. A and B run `_ensure_pty_locked` on the SAME session_key in parallel
         -> two `create-chat`, the second spawn kills the first PTY, orphan chat

    Note that a `lock.locked()` guard before the pop does not save step 2: at
    step 1 the lock is not held yet. `_session_lock` therefore refuses to remove
    an entry that has any user (holder or waiter), and no teardown path is
    allowed to pop it from outside.

    The assertions below are what fails if the pop ever comes back: the entry is
    still there and is still the SAME object, and B has to queue.
    """
    import app.main as main_mod
    from app.main import (_ensure_pty, store, task_store, pty_manager,
                          _session_locks, _session_lock_users)
    import uuid as uuid_mod

    await store.initialize()
    await task_store.initialize()
    session_key = f"lock-teardown-{uuid_mod.uuid4().hex[:8]}"
    await store.set(session_key, "chat-ja-existente")

    in_flight = 0
    max_in_flight = 0
    gates = []

    async def gated_locked(s_key, project_id, agent_id, cols, rows):
        """Stand-in for the critical section: parks inside it until released, so
        the test controls exactly who is in there and for how long."""
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        gate = asyncio.Event()
        gates.append(gate)
        await gate.wait()
        in_flight -= 1
        return MagicMock(), True, False, None

    with patch("app.main._ensure_pty_locked", gated_locked):
        caller_a = asyncio.create_task(_ensure_pty(session_key, "meu-projeto", None))
        await _wait_until(lambda: len(gates) == 1)

        held = _session_locks[session_key]
        assert _session_lock_users[session_key] == 1

        # Both session-teardown endpoints run while caller A is still inside the
        # critical section. pty_manager is stubbed out: this test is about the
        # lock dict, not about process teardown.
        with patch.object(pty_manager, "get", return_value=None):
            await main_mod.terminate_session(session_key)
        await store.set(session_key, "chat-ja-existente")
        with patch.object(pty_manager, "get", return_value=None):
            with patch.object(pty_manager, "terminate"):
                await main_mod.reset_session(session_key)

        assert _session_locks.get(session_key) is held, (
            "teardown removeu (ou trocou) o lock que um caller esta usando — "
            "o proximo caller criaria um Lock novo e rodaria em paralelo"
        )

        # Caller B arrives after the teardown. It must block on the very same
        # lock instance, not create a fresh one.
        caller_b = asyncio.create_task(_ensure_pty(session_key, "meu-projeto", None))
        await _wait_until(lambda: _session_lock_users.get(session_key) == 2)
        # Enough loop turns for B to have gotten in, had it been able to.
        await asyncio.sleep(0.05)

        assert len(gates) == 1, "caller B entrou na secao critica junto com A"
        assert max_in_flight == 1

        gates[0].set()
        await asyncio.wait_for(caller_a, timeout=2.0)
        await _wait_until(lambda: len(gates) == 2)
        gates[1].set()
        await asyncio.wait_for(caller_b, timeout=2.0)

    assert max_in_flight == 1, "dois callers rodaram _ensure_pty_locked em paralelo"
    assert session_key not in _session_locks
    assert session_key not in _session_lock_users

    await store.close()
    await task_store.close()


@pytest.mark.asyncio
async def test_lock_entry_survives_for_a_queued_waiter_and_is_reclaimed_after():
    """Covers the second window a `locked()`-based cleanup would miss.

    `Lock.release()` clears `_locked` BEFORE the next coroutine in the queue
    wakes up and re-takes it. So there is a real moment where a waiter is
    enqueued and `lock.locked()` answers False. Reclaiming the entry there would
    leave the waiter blocked on an orphan Lock while the next caller creates a
    brand-new one and runs concurrently with it.

    Sequence: A holds, B queues behind A, A leaves, C arrives. The entry must
    survive A's exit (B still needs it) and only be reclaimed once C is gone.
    """
    from app.main import _ensure_pty, _session_locks, _session_lock_users, store
    import uuid as uuid_mod

    await store.initialize()
    session_key = f"lock-waiter-{uuid_mod.uuid4().hex[:8]}"

    in_flight = 0
    max_in_flight = 0
    gates = []

    async def gated_locked(s_key, project_id, agent_id, cols, rows):
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        gate = asyncio.Event()
        gates.append(gate)
        await gate.wait()
        in_flight -= 1
        return MagicMock(), True, False, None

    with patch("app.main._ensure_pty_locked", gated_locked):
        caller_a = asyncio.create_task(_ensure_pty(session_key, "meu-projeto", None))
        await _wait_until(lambda: len(gates) == 1)
        first_lock = _session_locks[session_key]

        caller_b = asyncio.create_task(_ensure_pty(session_key, "meu-projeto", None))
        await _wait_until(lambda: _session_lock_users.get(session_key) == 2)

        # A hands the lock over to B. The entry must NOT be reclaimed here.
        gates[0].set()
        await asyncio.wait_for(caller_a, timeout=2.0)
        await _wait_until(lambda: len(gates) == 2)
        assert _session_locks.get(session_key) is first_lock, (
            "entrada reclamada com um waiter na fila — o waiter ficaria num Lock "
            "orfao e o caller seguinte entraria em paralelo com ele"
        )

        # C arrives while B is inside, through the exact window above.
        caller_c = asyncio.create_task(_ensure_pty(session_key, "meu-projeto", None))
        await _wait_until(lambda: _session_lock_users.get(session_key) == 2)
        await asyncio.sleep(0.05)
        assert len(gates) == 2, "caller C entrou na secao critica junto com B"

        gates[1].set()
        await asyncio.wait_for(caller_b, timeout=2.0)
        await _wait_until(lambda: len(gates) == 3)
        gates[2].set()
        await asyncio.wait_for(caller_c, timeout=2.0)

    assert max_in_flight == 1, "dois callers rodaram _ensure_pty_locked em paralelo"
    assert session_key not in _session_locks, "entrada nao foi reclamada no fim"
    assert session_key not in _session_lock_users

    await store.close()
