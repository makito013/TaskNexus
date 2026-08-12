"""Tests mcp_task_adapter.py as a standalone PYTHON subprocess — never the
`claude` CLI. Manually drives the JSON-RPC line-delimited stdio protocol via
stdin/stdout pipes, exactly as the real `claude` CLI would, and points the
adapter's outbound HTTP call at a local ephemeral http.server instead of the
real backend (via ESCRITORIO_HOOK_URL, an env override added specifically
for testability)."""

import json
import os
import subprocess
import sys
import threading
import http.server
import queue as queue_mod

ADAPTER_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "mcp_task_adapter.py")


class _CapturingHandler(http.server.BaseHTTPRequestHandler):
    received: "queue_mod.Queue" = queue_mod.Queue()
    # Per-test override: maps request path -> response dict to send back.
    # Default {} keeps the legacy behavior (empty JSON body) for the tests
    # that don't care about the response contract.
    responses: dict = {}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        self.__class__.received.put({
            "path": self.path,
            "headers": dict(self.headers),
            "body": json.loads(body) if body else None,
        })
        response_body = self.__class__.responses.get(self.path, {})
        payload = json.dumps(response_body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass  # silence default stderr logging


def _start_ephemeral_server(responses=None):
    _CapturingHandler.received = queue_mod.Queue()
    _CapturingHandler.responses = responses or {}
    server = http.server.HTTPServer(("127.0.0.1", 0), _CapturingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    return server, thread, port


class _AdapterProcess:
    """Thin wrapper around the subprocess: sends one JSON-RPC message per
    line to stdin, reads one JSON-RPC response per line from stdout. Uses a
    background thread + queue to read stdout so a call that (correctly)
    produces no response (e.g. a notification) doesn't hang the test."""

    def __init__(self, env):
        self.proc = subprocess.Popen(
            [sys.executable, ADAPTER_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            bufsize=1,
        )
        self._lines: "queue_mod.Queue" = queue_mod.Queue()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self):
        for line in self.proc.stdout:
            self._lines.put(line)

    def send(self, message):
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def recv(self, timeout=3.0):
        line = self._lines.get(timeout=timeout)
        return json.loads(line)

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2.0)
        except Exception:
            self.proc.kill()


def _make_adapter(port, session_id="test-session-id"):
    env = os.environ.copy()
    env["ESCRITORIO_HOOK_URL"] = "http://127.0.0.1:{0}/api/hooks/task".format(port)
    env["ESCRITORIO_CLAUDE_SESSION_ID"] = session_id
    return _AdapterProcess(env)


class _BinaryAdapterProcess:
    """Like _AdapterProcess, but writes raw UTF-8 bytes straight to stdin
    instead of going through Popen(text=True) — a text-mode pipe on this
    side would apply Python's own (possibly wrong) encoding when writing,
    reintroducing the exact bug this test is meant to catch on the
    adapter's reading side. bufsize=0 (not the text-mode bufsize=1 used by
    _AdapterProcess) because line buffering is a text-mode-only concept;
    passing bufsize=1 with text=False just emits a RuntimeWarning and
    silently falls back to unbuffered, so flushes are done explicitly
    below instead of relying on buffering semantics."""

    def __init__(self, env):
        self.proc = subprocess.Popen(
            [sys.executable, ADAPTER_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=False,
            bufsize=0,
        )
        self._lines: "queue_mod.Queue" = queue_mod.Queue()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self):
        for line in self.proc.stdout:
            self._lines.put(line)

    def send_utf8_line(self, message: dict):
        """Encodes `message` as UTF-8 bytes (never relying on the platform's
        default text encoding) and writes it + b"\\n" directly to stdin."""
        payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
        self.proc.stdin.write(payload + b"\n")
        self.proc.stdin.flush()

    def recv(self, timeout=3.0):
        line = self._lines.get(timeout=timeout)
        return json.loads(line.decode("utf-8"))

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2.0)
        except Exception:
            self.proc.kill()


def _make_hostile_env(port):
    """Env that reproduces the real-world Windows failure mode this test
    guards against: no PYTHONUTF8 (the main.py defense-in-depth env var is
    absent, as if _build_mcp_config_json's fix wasn't applied to this
    process) and PYTHONIOENCODING pinned to cp1252 (a legacy single-byte
    Windows codepage that cannot represent most UTF-8 continuation bytes as
    themselves), so decoding stdin with anything other than the explicit
    reconfigure("utf-8") in main() corrupts non-ASCII input. Inherited
    PYTHONUTF8/PYTHONIOENCODING from the current environment (pytest's own
    venv/shell) are popped first — otherwise this "hostile" env could
    accidentally inherit a friendly setting and the test would pass for the
    wrong reason, independent of the fix under test."""
    env = os.environ.copy()
    env.pop("PYTHONUTF8", None)
    env.pop("PYTHONIOENCODING", None)
    env["PYTHONIOENCODING"] = "cp1252"
    env["ESCRITORIO_HOOK_URL"] = "http://127.0.0.1:{0}/api/hooks/task".format(port)
    env["ESCRITORIO_CLAUDE_SESSION_ID"] = "test-session-id"
    return env


def test_initialize_echoes_protocol_version_and_capabilities():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {}},
            })
            response = adapter.recv()
            assert response["id"] == 1
            assert response["result"]["protocolVersion"] == "2024-11-05"
            assert response["result"]["capabilities"] == {"tools": {}}
            assert "serverInfo" in response["result"]
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_notifications_initialized_gets_no_response():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            # Follow up with a real request; if the notification had wrongly
            # produced a response, it would be the FIRST thing read here,
            # breaking this assertion.
            adapter.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            response = adapter.recv()
            assert response["id"] == 2
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_list_returns_criar_tarefa_validacao():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
            response = adapter.recv()
            tools = response["result"]["tools"]
            assert len(tools) == 1
            tool = tools[0]
            assert tool["name"] == "criar_tarefa_validacao"
            required = tool["inputSchema"]["required"]
            assert "titulo" in required
            assert "descricao_markdown" in required
            assert "descricao_html" not in required
            assert "descricao_html" in tool["inputSchema"]["properties"]
            # projeto_id (Tarefa 6): opcional (fora de `required`), string.
            assert "projeto_id" not in required
            assert tool["inputSchema"]["properties"]["projeto_id"]["type"] == "string"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_passes_projeto_id_in_body_when_provided():
    """projeto_id opcional (Tarefa 6): quando o agente informa, o adaptador
    repassa no corpo do POST para o backend validar."""
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port, session_id="sess-proj")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 40, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {
                        "titulo": "T",
                        "descricao_markdown": "D",
                        "projeto_id": "cliente/sub",
                    },
                },
            })
            adapter.recv()
            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["body"]["projeto_id"] == "cliente/sub"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_relays_backend_business_error_text():
    """P0 da correção do fire-and-forget mentiroso: quando o backend rejeita a
    criação ({success: False, error: ...}), o adaptador devolve o erro REAL ao
    agente — não mais o texto fixo "Tarefa de validação criada."."""
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/task": {"success": False, "error": "Projeto 'x' pertence a outro cliente"}}
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 41, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {"titulo": "T", "descricao_markdown": "D", "projeto_id": "x"},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert text == "Projeto 'x' pertence a outro cliente"
            assert text != "Tarefa de validação criada."
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_success_returns_created_text():
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/task": {"success": True}}
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 42, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {"titulo": "T", "descricao_markdown": "D"},
                },
            })
            response = adapter.recv()
            assert response["result"]["content"][0]["text"] == "Tarefa de validação criada."
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_noop_session_returns_informative_text():
    """Resposta {status: ok} do no-op silencioso (claude_session_id não
    resolve): sem chave `success`, o adaptador não finge sucesso — informa que
    a sessão não foi encontrada."""
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/task": {"status": "ok"}}
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 43, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {"titulo": "T", "descricao_markdown": "D"},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert text != "Tarefa de validação criada."
            assert "sessão não encontrada" in text
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_posts_to_hook_url_with_session_id_and_responds_success():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port, session_id="session-abc-123")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {
                        "titulo": "Revisar migração",
                        "descricao_markdown": "Confirme os passos.",
                    },
                },
            })
            response = adapter.recv()
            assert response["id"] == 4
            assert "content" in response["result"]
            assert response["result"]["content"][0]["type"] == "text"

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/task"
            assert received["body"]["claude_session_id"] == "session-abc-123"
            assert received["body"]["titulo"] == "Revisar migração"
            assert received["body"]["descricao_markdown"] == "Confirme os passos."
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_tools_call_responds_even_if_http_post_fails():
    """Fire-and-forget: pointing at a port nobody is listening on must still
    yield a response to the claude CLI (never hang/crash the adapter)."""
    adapter = _make_adapter(port=1)  # port 1 is a privileged, unlisted port -> connection refused
    try:
        adapter.send({
            "jsonrpc": "2.0", "id": 5, "method": "tools/call",
            "params": {
                "name": "criar_tarefa_validacao",
                "arguments": {"titulo": "T", "descricao_markdown": "D"},
            },
        })
        response = adapter.recv(timeout=5.0)
        assert response["id"] == 5
        assert "content" in response["result"]
    finally:
        adapter.close()


def test_unknown_method_with_id_returns_method_not_found_error():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "id": 6, "method": "not/a/real/method"})
            response = adapter.recv()
            assert response["id"] == 6
            assert response["error"]["code"] == -32601
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_unknown_notification_without_id_gets_no_response():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "method": "not/a/real/notification"})
            adapter.send({"jsonrpc": "2.0", "id": 7, "method": "tools/list"})
            response = adapter.recv()
            assert response["id"] == 7
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_criar_tarefa_preserves_utf8_accents_under_hostile_windows_encoding():
    """Regression test for the mojibake bug: a UTF-8-encoded request written
    as raw bytes to stdin (never through Python's own text-mode encoding)
    must reach the backend POST body intact even when the child process's
    default encoding is a hostile Windows codepage (PYTHONIOENCODING=cp1252,
    no PYTHONUTF8) — i.e. `for line in sys.stdin` inside main() must decode
    as UTF-8 regardless of locale.getpreferredencoding(), which is exactly
    what main()'s stdin.reconfigure("utf-8") guarantees."""
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/task": {"success": True}}
    )
    try:
        env = _make_hostile_env(port)
        adapter = _BinaryAdapterProcess(env)
        try:
            adapter.send_utf8_line({
                "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {
                    "name": "criar_tarefa_validacao",
                    "arguments": {
                        "titulo": "Revisão de código",
                        "descricao_markdown": "Confirme a validação da migração",
                    },
                },
            })
            response = adapter.recv(timeout=5.0)
            text = response["result"]["content"][0]["text"]
            assert text == "Tarefa de validação criada."

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["body"]["titulo"] == "Revisão de código"
            assert received["body"]["descricao_markdown"] == "Confirme a validação da migração"
        finally:
            adapter.close()
    finally:
        server.shutdown()
