"""Tests mcp_card_adapter.py as a standalone PYTHON subprocess — never the
`claude` CLI. Manually drives the JSON-RPC line-delimited stdio protocol via
stdin/stdout pipes, exactly as the real `claude` CLI would, and points the
adapter's outbound HTTP calls at a local ephemeral http.server instead of the
real backend (via ESCRITORIO_HOOK_CREATE_URL/ESCRITORIO_HOOK_MOVE_URL, env
overrides added specifically for testability — mesmo padrão de
ESCRITORIO_HOOK_URL em test_mcp_task_adapter.py).

Different from test_mcp_task_adapter.py in one key way: this adapter is NOT
fire-and-forget-silent. The fake server below is configurable per-test to
return {"success": True, ...} or {"success": False, "error": "..."}, and the
tests assert the tool's text result reflects that, not a fixed success
string."""

import json
import os
import subprocess
import sys
import threading
import http.server
import queue as queue_mod

ADAPTER_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "mcp_card_adapter.py")


class _CapturingHandler(http.server.BaseHTTPRequestHandler):
    received: "queue_mod.Queue" = queue_mod.Queue()
    # Per-test override: maps request path -> response dict to send back.
    responses: dict = {}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        parsed_body = json.loads(body) if body else None
        self.__class__.received.put({
            "path": self.path,
            "headers": dict(self.headers),
            "body": parsed_body,
        })
        response_body = self.__class__.responses.get(self.path, {"status": "ok"})
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
    env["ESCRITORIO_HOOK_CREATE_URL"] = "http://127.0.0.1:{0}/api/hooks/cards/create".format(port)
    env["ESCRITORIO_HOOK_MOVE_URL"] = "http://127.0.0.1:{0}/api/hooks/cards/move".format(port)
    env["ESCRITORIO_CLAUDE_SESSION_ID"] = session_id
    return _AdapterProcess(env)


def test_tools_list_returns_criar_card_and_mover_card_with_correct_schemas():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            response = adapter.recv()
            tools = response["result"]["tools"]
            assert len(tools) == 2
            by_name = {t["name"]: t for t in tools}
            assert set(by_name.keys()) == {"criar_card", "mover_card"}

            criar = by_name["criar_card"]
            assert criar["inputSchema"]["required"] == ["titulo"]
            props = criar["inputSchema"]["properties"]
            assert set(props.keys()) == {"titulo", "status", "descricao", "parent_id", "projeto_id"}
            assert props["status"]["enum"] == ["a_fazer", "em_andamento"]
            assert props["parent_id"]["type"] == "integer"
            # projeto_id (Tarefa 6): opcional (fora de `required`), string.
            assert "projeto_id" not in criar["inputSchema"]["required"]
            assert props["projeto_id"]["type"] == "string"

            mover = by_name["mover_card"]
            assert set(mover["inputSchema"]["required"]) == {"card_id", "novo_status"}
            mover_props = mover["inputSchema"]["properties"]
            assert mover_props["novo_status"]["enum"] == [
                "a_fazer", "em_andamento", "em_revisao", "feito",
            ]
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_criar_card_success_posts_to_create_url_and_returns_success_text():
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/create": {"success": True, "card_id": 42}}
    )
    try:
        adapter = _make_adapter(port, session_id="session-abc-123")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {
                    "name": "criar_card",
                    "arguments": {"titulo": "Escrever testes", "status": "a_fazer"},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "sucesso" in text.lower()
            assert "42" in text

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/create"
            assert received["body"]["claude_session_id"] == "session-abc-123"
            assert received["body"]["titulo"] == "Escrever testes"
            assert received["body"]["status"] == "a_fazer"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_criar_card_business_rule_error_returns_error_text_not_fake_success():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/create": {
                "success": False,
                "error": "Card pai não encontrado ou já é subcard",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {
                    "name": "criar_card",
                    "arguments": {"titulo": "Subtarefa", "parent_id": 999},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert text == "Card pai não encontrado ou já é subcard"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_mover_card_success_posts_to_move_url_and_returns_success_text():
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/move": {"success": True}}
    )
    try:
        adapter = _make_adapter(port, session_id="session-xyz")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {
                    "name": "mover_card",
                    "arguments": {"card_id": 7, "novo_status": "em_andamento"},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "sucesso" in text.lower()

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/move"
            assert received["body"]["claude_session_id"] == "session-xyz"
            assert received["body"]["card_id"] == 7
            assert received["body"]["novo_status"] == "em_andamento"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_mover_card_permission_error_returns_error_text_not_fake_success():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/move": {
                "success": False,
                "error": "Card 7 pertence a outro cliente",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": {
                    "name": "mover_card",
                    "arguments": {"card_id": 7, "novo_status": "feito"},
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "outro cliente" in text
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_criar_card_connectivity_failure_does_not_hang_and_returns_generic_error():
    """Pointing at a port nobody is listening on must still yield a response
    to the claude CLI (never hang/crash the adapter) — and the text must be a
    generic connectivity error, never a fake success message."""
    adapter = _make_adapter(port=1)  # port 1 is privileged/unlisted -> connection refused
    try:
        adapter.send({
            "jsonrpc": "2.0", "id": 6, "method": "tools/call",
            "params": {
                "name": "criar_card",
                "arguments": {"titulo": "T"},
            },
        })
        response = adapter.recv(timeout=5.0)
        text = response["result"]["content"][0]["text"]
        assert "sucesso" not in text.lower()
        assert "não foi possível conectar" in text.lower()
    finally:
        adapter.close()


def test_mover_card_connectivity_failure_does_not_hang_and_returns_generic_error():
    adapter = _make_adapter(port=1)
    try:
        adapter.send({
            "jsonrpc": "2.0", "id": 7, "method": "tools/call",
            "params": {
                "name": "mover_card",
                "arguments": {"card_id": 1, "novo_status": "feito"},
            },
        })
        response = adapter.recv(timeout=5.0)
        text = response["result"]["content"][0]["text"]
        assert "sucesso" not in text.lower()
        assert "não foi possível conectar" in text.lower()
    finally:
        adapter.close()
