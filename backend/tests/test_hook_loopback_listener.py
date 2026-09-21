"""Phase 0: the loopback listener that keeps the Stop hook alive in production.

The Stop hook (and the MCP adapters) call this backend over HTTP. Their URL used
to be a hardcoded `http://localhost:8000`, which only ever matched the dev flow —
`deploy.ps1` serves the app on 443/80, so in the real deployment nothing was
listening on 8000 and the whole hook channel was dead.

The fix is a second uvicorn instance inside the same process, bound to
127.0.0.1 on its own port, so the hook channel no longer depends on which port
the public server happens to use. These tests pin the three properties that
make that safe to ship: it is off unless asked for, a failed bind never takes
the main process down, and it never steals the process signal handlers.
"""

import importlib
import json
import os
import signal
import socket
import sys
import time
import urllib.request
import uuid as uuid_mod
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _occupy_free_port() -> socket.socket:
    """A LISTENING socket on an OS-chosen free port, handed over still OPEN.

    For the tests that need a port to be BUSY. There is no window here at all:
    the socket that picks the port is the same one that keeps holding it, so
    nothing can slip in between choosing and occupying. Callers read the number
    off `getsockname()` and close the socket when done.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
    except BaseException:
        sock.close()
        raise
    return sock


def _candidate_port() -> int:
    """A port the OS reported free a moment ago — a CANDIDATE, not a promise.

    Binding port 0 and closing the probe is inherently TOCTOU: the port is
    released before the app claims it, and anything else on the machine can
    take it in between. This bit the suite twice in one day under concurrent
    runs (the live backend plus a second pytest).

    Holding the probe open instead is not an option: the app binds the very
    same port, and `_bind_hook_loopback_socket` sets SO_REUSEADDR only on
    POSIX, where it still does not permit two live listeners. A held socket
    would guarantee the failure it was meant to prevent.

    So the race is CLOSED BY DETECTION rather than by avoidance: callers go
    through `_running_app_with_listener`, which notices a lost race and retries
    on a fresh port. Never call this directly for a port that has to work.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def _running_app(tmp_path, **env_overrides):
    """Reloads app.main under the given env and yields (module, TestClient).

    Same reload-under-patched-env recipe the other endpoint suites use: the
    module reads its configuration at import time, and the loopback listener is
    started by the real lifespan, which `with TestClient(app)` runs.
    """
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True, exist_ok=True)
    env = {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }
    env.update(env_overrides)
    with patch.dict("os.environ", env):
        # A stale value inherited from the developer's shell would silently
        # invert the "off by default" tests.
        for leftover in ("HOOK_LOOPBACK_PORT", "HOOK_CALLBACK_BASE_URL"):
            if leftover not in env_overrides:
                os.environ.pop(leftover, None)
        import app.main as main_mod
        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            yield main_mod, client


@contextmanager
def _running_app_with_listener(tmp_path, attempts=6, **env_overrides):
    """`_running_app` on a loopback port the listener ACTUALLY came up on.

    Yields `(main_mod, client, port)`. If the port was stolen between
    `_candidate_port` and the app's own bind, `_hook_loopback_server` comes
    back None — that is the lost race, and it is retried on a fresh port with a
    short backoff instead of failing the test.

    Losing every attempt still fails loudly: the retry only absorbs a race, it
    never turns a genuinely broken listener into a pass. Any test that asserts
    the listener is UP should use this; the two that deliberately occupy a port
    should use `_occupy_free_port` instead.
    """
    for attempt in range(attempts):
        port = _candidate_port()
        with _running_app(
            tmp_path, HOOK_LOOPBACK_PORT=str(port), **env_overrides
        ) as (main_mod, client):
            if main_mod._hook_loopback_server is not None:
                yield main_mod, client, port
                return
        # Lost the race — back off briefly so the winner has a chance to move
        # on, then try a different port.
        time.sleep(0.05 * (2 ** attempt))

    raise AssertionError(
        f"loopback listener failed to bind on {attempts} different free ports; "
        "that is no longer explainable as a port race"
    )


def _register_session(client, session_key, claude_session_id):
    """Maps session_key -> claude_session_id in the ConversationStore.

    The real `claude` CLI is never spawned (_build_pty_cmd is swapped for a
    harmless sleep) and uuid4 is pinned, so the test knows exactly which id the
    hook has to resolve — same technique as
    test_hook_stop_marks_needs_attention_for_known_session.
    """
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=claude_session_id):
            with client.websocket_connect(f"/ws/pty/{session_key}") as ws:
                ws.send_json({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                time.sleep(0.2)


def _post_json(url, payload, timeout=5):
    """Real HTTP POST over TCP — the point of these tests is that the request
    travels through the loopback socket, not through TestClient's in-process
    ASGI shortcut."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


# --- off by default ---------------------------------------------------------

def test_loopback_listener_stays_off_without_the_env_var(tmp_path):
    """No HOOK_LOOPBACK_PORT, no second listener.

    This is what keeps every existing TestClient suite working: if the listener
    were on by default, each of them would try to claim a fixed port.
    """
    with _running_app(tmp_path) as (main_mod, client):
        assert main_mod._hook_loopback_server is None
        assert main_mod._hook_loopback_task is None
        # The app itself is untouched — hooks still answer in-process.
        assert client.post("/api/hooks/stop", json={}).status_code == 200


@pytest.mark.parametrize("bad_value", ["", "   ", "not-a-port", "0", "70000", "-1"])
def test_invalid_port_value_disables_the_listener_instead_of_crashing(tmp_path, bad_value):
    """A typo in HOOK_LOOPBACK_PORT must degrade to "no hook channel", never to
    "no backend": the notification feature is not allowed to be a reason for the
    whole process to fail to boot."""
    with _running_app(tmp_path, HOOK_LOOPBACK_PORT=bad_value) as (main_mod, client):
        assert main_mod._hook_loopback_port() is None
        assert main_mod._hook_loopback_server is None
        assert client.get("/api/sessions/persisted").status_code == 200


# --- the actual channel -----------------------------------------------------

def test_stop_hook_reaches_the_backend_through_the_loopback_port(tmp_path):
    """The whole point of Phase 0: a real HTTP POST to the loopback port marks
    the session as needing attention.

    The app under test is served by TestClient and has no public TCP port at
    all, so the request provably arrives through the dedicated listener and
    nowhere else — exactly the production situation where the app's own port
    (443) is not where the hook is pointed.
    """
    claude_session_id = uuid_mod.UUID("33333333-3333-3333-3333-333333333333")

    with _running_app_with_listener(tmp_path) as (main_mod, client, port):
        assert main_mod._hook_loopback_server is not None
        _register_session(client, "loopback-test", claude_session_id)

        status, _ = _post_json(
            f"http://127.0.0.1:{port}/api/hooks/stop",
            {"session_id": str(claude_session_id)},
        )
        assert status == 200

        meta = client.get("/api/sessions/persisted").json()
        assert meta["loopback-test"]["needs_attention"] is True


def test_loopback_listener_binds_loopback_only(tmp_path):
    """Never reachable from the tailnet/LAN: the listener exists to be called by
    processes on this machine, and binding 0.0.0.0 would publish an unauthenticated
    hook surface to the network."""
    with _running_app_with_listener(tmp_path) as (main_mod, _client, port):
        server = main_mod._hook_loopback_server
        deadline = time.time() + 5
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        assert server.started, "loopback listener never finished starting"
        bound = [s.getsockname() for s in server.servers[0].sockets]
        assert bound == [("127.0.0.1", port)]


def test_app_survives_a_loopback_port_that_is_already_taken(tmp_path):
    """A busy port must cost the hook channel, not the backend.

    Letting uvicorn open the socket itself would end in `sys.exit(1)` here (see
    Server.startup) and kill the whole process; pre-binding turns it into a
    warning.
    """
    # The squatter picks its OWN port and never lets go of it, so there is no
    # window between choosing and occupying for another process to slip into.
    squatter = _occupy_free_port()
    try:
        port = squatter.getsockname()[1]

        with _running_app(tmp_path, HOOK_LOOPBACK_PORT=str(port)) as (main_mod, client):
            assert main_mod._hook_loopback_server is None
            # Still fully alive, which is the assertion that matters.
            assert client.get("/api/sessions/persisted").status_code == 200
    finally:
        squatter.close()


def test_starting_the_listener_leaves_process_wide_logging_untouched(tmp_path):
    """`uvicorn.Config.configure_logging()` mutates GLOBAL loggers on
    construction, so building a second Config can silently undo the first
    server's logging setup.

    Two ways in, both already hit once: the default `log_config` re-runs
    `dictConfig` and replaces the handlers of `uvicorn.access`/`uvicorn.error`
    (wiping what `install_benign_transfer_error_filter` set up), and
    `access_log=False` empties `uvicorn.access` process-wide — which silenced
    the MAIN server's access log, not just the loopback one.
    """
    import logging

    access_logger = logging.getLogger("uvicorn.access")
    error_logger = logging.getLogger("uvicorn.error")
    sentinel_handler = logging.NullHandler()
    sentinel_filter = logging.Filter()
    propagate_before = access_logger.propagate

    access_logger.addHandler(sentinel_handler)
    error_logger.addFilter(sentinel_filter)
    try:
        with _running_app_with_listener(tmp_path) as (main_mod, _c, _port):
            assert main_mod._hook_loopback_server is not None, "listener never started"
            assert sentinel_handler in access_logger.handlers
            assert access_logger.propagate is propagate_before
            assert sentinel_filter in error_logger.filters
    finally:
        access_logger.removeHandler(sentinel_handler)
        error_logger.removeFilter(sentinel_filter)


# --- signal handling --------------------------------------------------------

def test_loopback_server_leaves_the_process_signal_handlers_alone():
    """The second uvicorn instance must not become the process' SIGINT owner.

    Tested directly instead of end-to-end on purpose: under TestClient the
    lifespan runs on a portal thread, where uvicorn's `capture_signals` already
    returns early on its own — an end-to-end test would pass even with the
    override removed. Here the call happens on the main thread, where the base
    implementation really does swap the handlers (asserted below, so this test
    fails if either side of the contract changes).
    """
    import uvicorn
    import app.main as main_mod

    config = uvicorn.Config(main_mod.app, log_config=None)
    before = signal.getsignal(signal.SIGINT)

    with main_mod._DetachedSignalsServer(config).capture_signals():
        assert signal.getsignal(signal.SIGINT) is before
    assert signal.getsignal(signal.SIGINT) is before

    # Control: stock uvicorn.Server is exactly what we are protecting against.
    with uvicorn.Server(config).capture_signals():
        assert signal.getsignal(signal.SIGINT) is not before
    assert signal.getsignal(signal.SIGINT) is before


# --- callback URLs handed to the CLI ----------------------------------------

def test_stop_hook_settings_target_the_loopback_port_when_configured():
    """The --settings blob the CLI gets must curl the loopback port, otherwise
    the listener is up and nothing ever calls it.

    `_hook_loopback_server` is patched to a sentinel here because
    `_hook_callback_base_url()` now trusts the listener's real state, not just
    the configured port (see test_hook_callback_url_falls_back_when_the_loopback_bind_fails)
    — this test calls the settings builder directly, without going through the
    real lifespan that would otherwise set it.
    """
    import app.main as main_mod

    with patch.dict("os.environ", {"HOOK_LOOPBACK_PORT": "9123"}):
        with patch.object(main_mod, "_hook_loopback_server", object()):
            settings = json.loads(main_mod._build_stop_hook_settings())
    command = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
    assert "http://127.0.0.1:9123/api/hooks/stop" in command


def test_stop_hook_settings_fall_back_to_the_app_port():
    """Without a loopback listener the hook keeps pointing at the port the app
    itself serves in dev / deploy.sh — the pre-Phase-0 behaviour."""
    import app.main as main_mod

    with patch.dict("os.environ", {}, clear=False):
        os.environ.pop("HOOK_LOOPBACK_PORT", None)
        os.environ.pop("HOOK_CALLBACK_BASE_URL", None)
        settings = json.loads(main_mod._build_stop_hook_settings())
    command = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
    assert "http://127.0.0.1:8000/api/hooks/stop" in command


def test_hook_callback_base_url_honours_an_explicit_override():
    """Escape hatch for deployments neither heuristic covers (proxy, container)."""
    import app.main as main_mod

    with patch.dict("os.environ", {
        "HOOK_CALLBACK_BASE_URL": "http://10.0.0.5:9999/",
        "HOOK_LOOPBACK_PORT": "9123",
    }):
        assert main_mod._hook_callback_base_url() == "http://10.0.0.5:9999"


def test_mcp_adapters_are_pointed_at_the_hook_channel():
    """The MCP adapters run as child processes of the CLI and had the same
    hardcoded-8000 defect; they already read their URL from the environment, so
    the fix is just to pass it in.

    `_hook_loopback_server` is patched to a sentinel for the same reason as in
    test_stop_hook_settings_target_the_loopback_port_when_configured: this test
    calls the config builder directly, bypassing the real lifespan that would
    otherwise set it.
    """
    import app.main as main_mod

    with patch.dict("os.environ", {"HOOK_LOOPBACK_PORT": "9123"}):
        with patch.object(main_mod, "_hook_loopback_server", object()):
            config = json.loads(main_mod._build_mcp_config_json("session-abc"))

    tasks_env = config["mcpServers"]["escritorio-tarefas"]["env"]
    cards_env = config["mcpServers"]["escritorio-cards"]["env"]
    assert tasks_env["ESCRITORIO_HOOK_URL"] == "http://127.0.0.1:9123/api/hooks/task"
    assert cards_env["ESCRITORIO_HOOK_CREATE_URL"] == "http://127.0.0.1:9123/api/hooks/cards/create"
    assert cards_env["ESCRITORIO_HOOK_MOVE_URL"] == "http://127.0.0.1:9123/api/hooks/cards/move"
    # The session id every adapter needs must survive the added keys.
    assert tasks_env["ESCRITORIO_CLAUDE_SESSION_ID"] == "session-abc"
    assert cards_env["ESCRITORIO_CLAUDE_SESSION_ID"] == "session-abc"


def test_hook_callback_url_falls_back_when_the_loopback_bind_fails(tmp_path):
    """A busy loopback port must not leave the CLI pointed at a dead port.

    `_hook_callback_base_url()` used to derive the callback URL purely from
    HOOK_LOOPBACK_PORT's config value, never from whether the listener actually
    came up. Combined with test_app_survives_a_loopback_port_that_is_already_taken
    (pre-bind turns a busy port into a warning, not a crash), that meant a busy
    port produced a URL nobody was listening on: `_hook_loopback_server` stays
    None, but the old code still pointed the Stop hook and the MCP adapters at
    HOOK_LOOPBACK_PORT. This asserts the fallback (DEFAULT_HOOK_PORT) is used
    instead whenever the listener object is not actually up.
    """
    # The squatter picks its OWN port and never lets go of it, so there is no
    # window between choosing and occupying for another process to slip into.
    squatter = _occupy_free_port()
    try:
        port = squatter.getsockname()[1]

        with _running_app(tmp_path, HOOK_LOOPBACK_PORT=str(port)) as (main_mod, _client):
            assert main_mod._hook_loopback_server is None, "bind should have failed"
            assert (
                main_mod._hook_callback_base_url()
                == f"http://127.0.0.1:{main_mod.DEFAULT_HOOK_PORT}"
            )

            settings = json.loads(main_mod._build_stop_hook_settings())
            command = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            assert f"http://127.0.0.1:{port}/api/hooks/stop" not in command
            assert f"http://127.0.0.1:{main_mod.DEFAULT_HOOK_PORT}/api/hooks/stop" in command
    finally:
        squatter.close()
