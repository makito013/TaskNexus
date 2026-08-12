"""Tests mcp_card_adapter.py as a standalone PYTHON subprocess — never the
`claude` CLI. Manually drives the JSON-RPC line-delimited stdio protocol via
stdin/stdout pipes, exactly as the real `claude` CLI would, and points the
adapter's outbound HTTP calls at a local ephemeral http.server instead of the
real backend (via the ESCRITORIO_HOOK_*_URL env overrides, one per hook, added
specifically for testability — mesmo padrão de ESCRITORIO_HOOK_URL em
test_mcp_task_adapter.py).

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


# Uma env var de URL por hook — cada tool tem a sua, mesmo padrão do
# _build_mcp_config_json em app/main.py.
_HOOK_URL_ENV_BY_PATH = {
    "ESCRITORIO_HOOK_CREATE_URL": "create",
    "ESCRITORIO_HOOK_MOVE_URL": "move",
    "ESCRITORIO_HOOK_UPDATE_URL": "update",
    "ESCRITORIO_HOOK_DELETE_URL": "delete",
    "ESCRITORIO_HOOK_GET_URL": "get",
    "ESCRITORIO_HOOK_LIST_URL": "list",
}


def _hook_url_env(port):
    return {
        name: "http://127.0.0.1:{0}/api/hooks/cards/{1}".format(port, path)
        for name, path in _HOOK_URL_ENV_BY_PATH.items()
    }


def _make_adapter(port, session_id="test-session-id"):
    env = os.environ.copy()
    env.update(_hook_url_env(port))
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
    env.update(_hook_url_env(port))
    env["ESCRITORIO_CLAUDE_SESSION_ID"] = "test-session-id"
    return env


def test_tools_list_returns_all_six_card_tools_with_correct_schemas():
    server, thread, port = _start_ephemeral_server()
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            response = adapter.recv()
            tools = response["result"]["tools"]
            assert len(tools) == 6
            by_name = {t["name"]: t for t in tools}
            assert set(by_name.keys()) == {
                "criar_card", "mover_card", "editar_card",
                "excluir_card", "ver_card", "listar_cards",
            }

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

            # -- Fase 3 --------------------------------------------------
            editar = by_name["editar_card"]
            assert editar["inputSchema"]["required"] == ["card_id"]
            editar_props = editar["inputSchema"]["properties"]
            assert set(editar_props.keys()) == {
                "card_id", "titulo", "descricao", "status",
            }
            assert editar_props["card_id"]["type"] == "integer"
            assert editar_props["status"]["enum"] == [
                "a_fazer", "em_andamento", "em_revisao", "feito",
            ]

            for name in ("excluir_card", "ver_card"):
                tool = by_name[name]
                assert tool["inputSchema"]["required"] == ["card_id"]
                assert set(tool["inputSchema"]["properties"].keys()) == {"card_id"}
                assert tool["inputSchema"]["properties"]["card_id"]["type"] == "integer"

            listar = by_name["listar_cards"]
            # Tool ÚNICA: sem argumento nenhum obrigatório, projeto_id opcional
            # e NENHUM parâmetro cliente_id (a regra "mesmo cliente" já
            # restringe o resultado ao cliente da sessão).
            assert listar["inputSchema"]["required"] == []
            assert set(listar["inputSchema"]["properties"].keys()) == {"projeto_id"}
            assert listar["inputSchema"]["properties"]["projeto_id"]["type"] == "string"

            # A restrição "mesmo cliente" precisa estar declarada na descrição
            # de toda tool que opera sobre card existente, igual mover_card.
            for name in ("editar_card", "excluir_card", "ver_card", "listar_cards"):
                assert "mesmo cliente" in by_name[name]["description"]
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


def test_criar_card_preserves_utf8_accents_under_hostile_windows_encoding():
    """Regression test for the mojibake bug: a UTF-8-encoded request written
    as raw bytes to stdin (never through Python's own text-mode encoding)
    must reach the backend POST body intact even when the child process's
    default encoding is a hostile Windows codepage (PYTHONIOENCODING=cp1252,
    no PYTHONUTF8) — i.e. `for line in sys.stdin` inside main() must decode
    as UTF-8 regardless of locale.getpreferredencoding(), which is exactly
    what main()'s stdin.reconfigure("utf-8") guarantees."""
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/create": {"success": True, "card_id": 99}}
    )
    try:
        env = _make_hostile_env(port)
        adapter = _BinaryAdapterProcess(env)
        try:
            adapter.send_utf8_line({
                "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {
                    "name": "criar_card",
                    "arguments": {
                        "titulo": "Revisão de código",
                        "descricao": "Não é possível editar sem revisão prévia",
                    },
                },
            })
            response = adapter.recv(timeout=5.0)
            text = response["result"]["content"][0]["text"]
            assert "sucesso" in text.lower()

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["body"]["titulo"] == "Revisão de código"
            assert received["body"]["descricao"] == "Não é possível editar sem revisão prévia"
        finally:
            adapter.close()
    finally:
        server.shutdown()


# -- Fase 3: editar_card / excluir_card / ver_card / listar_cards ------------


def test_editar_card_success_posts_to_update_url_and_returns_success_text():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/update": {
                "success": True,
                "card": {"id": 7, "titulo": "Novo título"},
            }
        }
    )
    try:
        adapter = _make_adapter(port, session_id="session-edit")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 10, "method": "tools/call",
                "params": {
                    "name": "editar_card",
                    "arguments": {
                        "card_id": 7,
                        "titulo": "Novo título",
                        "status": "em_revisao",
                    },
                },
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "sucesso" in text.lower()

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/update"
            assert received["body"]["claude_session_id"] == "session-edit"
            assert received["body"]["card_id"] == 7
            assert received["body"]["titulo"] == "Novo título"
            assert received["body"]["status"] == "em_revisao"
            # campo não informado vai como None (o backend trata como
            # "não veio no PATCH", nunca como "limpar o campo")
            assert received["body"]["descricao"] is None
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_editar_card_permission_error_returns_error_text_not_fake_success():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/update": {
                "success": False,
                "error": "Card 7 pertence a outro cliente",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 11, "method": "tools/call",
                "params": {"name": "editar_card", "arguments": {"card_id": 7, "titulo": "X"}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert text == "Card 7 pertence a outro cliente"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_excluir_card_success_reports_subcards_afetados():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/delete": {"success": True, "subcards_afetados": 3}
        }
    )
    try:
        adapter = _make_adapter(port, session_id="session-del")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 12, "method": "tools/call",
                "params": {"name": "excluir_card", "arguments": {"card_id": 4}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "sucesso" in text.lower()
            assert "3" in text

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/delete"
            assert received["body"] == {
                "claude_session_id": "session-del", "card_id": 4,
            }
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_excluir_card_nonexistent_returns_error_text_not_fake_success():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/delete": {
                "success": False,
                "error": "Card 999 não existe ou foi removido",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 13, "method": "tools/call",
                "params": {"name": "excluir_card", "arguments": {"card_id": 999}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "sucesso" not in text.lower()
            assert "não existe" in text
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_ver_card_success_returns_card_payload_as_text():
    """A resposta útil de ver_card é o próprio card — não uma frase fixa de
    confirmação."""
    card = {
        "id": 5,
        "titulo": "Revisão de código",
        "descricao": "conteúdo",
        "status": "em_andamento",
        "projeto_id": "cliente/aadmin",
    }
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/get": {"success": True, "card": card}}
    )
    try:
        adapter = _make_adapter(port, session_id="session-get")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 14, "method": "tools/call",
                "params": {"name": "ver_card", "arguments": {"card_id": 5}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert json.loads(text) == card

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/get"
            assert received["body"] == {
                "claude_session_id": "session-get", "card_id": 5,
            }
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_ver_card_other_cliente_returns_error_text():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/get": {
                "success": False,
                "error": "Card 5 pertence a outro cliente",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 15, "method": "tools/call",
                "params": {"name": "ver_card", "arguments": {"card_id": 5}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "outro cliente" in text
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_listar_cards_without_projeto_id_omits_the_key_from_the_body():
    """Mandar projeto_id="" faria o backend estreitar a listagem para o projeto
    da conversa em vez do cliente inteiro — a chave tem que ficar de fora."""
    cards = [{"id": 1, "titulo": "A"}, {"id": 2, "titulo": "B"}]
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/list": {"success": True, "cards": cards, "total": 2}}
    )
    try:
        adapter = _make_adapter(port, session_id="session-list")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 16, "method": "tools/call",
                "params": {"name": "listar_cards", "arguments": {}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert "2 card" in text
            assert "titulo" in text

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["path"] == "/api/hooks/cards/list"
            assert received["body"] == {"claude_session_id": "session-list"}
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_listar_cards_empty_projeto_id_is_treated_as_omitted():
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/list": {"success": True, "cards": [], "total": 0}}
    )
    try:
        adapter = _make_adapter(port, session_id="session-list")
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 17, "method": "tools/call",
                "params": {"name": "listar_cards", "arguments": {"projeto_id": ""}},
            })
            adapter.recv()
            received = _CapturingHandler.received.get(timeout=3.0)
            assert "projeto_id" not in received["body"]
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_listar_cards_with_projeto_id_forwards_the_filter():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/list": {
                "success": True, "cards": [{"id": 9}], "total": 1,
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 18, "method": "tools/call",
                "params": {
                    "name": "listar_cards",
                    "arguments": {"projeto_id": "cliente/outro"},
                },
            })
            response = adapter.recv()
            assert "1 card" in response["result"]["content"][0]["text"]

            received = _CapturingHandler.received.get(timeout=3.0)
            assert received["body"]["projeto_id"] == "cliente/outro"
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_listar_cards_empty_list_is_reported_as_success_not_as_missing_session():
    """Lista vazia (success=True, cards=[]) tem que virar "nenhum card
    encontrado", nunca a mensagem de sessão não encontrada."""
    server, thread, port = _start_ephemeral_server(
        responses={"/api/hooks/cards/list": {"success": True, "cards": [], "total": 0}}
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 19, "method": "tools/call",
                "params": {"name": "listar_cards", "arguments": {}},
            })
            response = adapter.recv()
            text = response["result"]["content"][0]["text"]
            assert text == "Nenhum card encontrado."
            assert "sessão" not in text
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_listar_cards_other_cliente_projeto_id_returns_error_text():
    server, thread, port = _start_ephemeral_server(
        responses={
            "/api/hooks/cards/list": {
                "success": False,
                "error": "Projeto 'outrocliente/proj' pertence a outro cliente",
            }
        }
    )
    try:
        adapter = _make_adapter(port)
        try:
            adapter.send({
                "jsonrpc": "2.0", "id": 20, "method": "tools/call",
                "params": {
                    "name": "listar_cards",
                    "arguments": {"projeto_id": "outrocliente/proj"},
                },
            })
            response = adapter.recv()
            assert "outro cliente" in response["result"]["content"][0]["text"]
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_new_tools_unknown_session_noop_is_reported_as_not_processed():
    """No-op silencioso do backend ({"status": "ok"}, sem a chave `success`)
    nunca pode virar uma confirmação falsa de que a ação aconteceu."""
    server, thread, port = _start_ephemeral_server()  # default: {"status": "ok"}
    try:
        adapter = _make_adapter(port)
        try:
            for i, (tool, args) in enumerate([
                ("editar_card", {"card_id": 1, "titulo": "X"}),
                ("excluir_card", {"card_id": 1}),
                ("ver_card", {"card_id": 1}),
                ("listar_cards", {}),
            ]):
                adapter.send({
                    "jsonrpc": "2.0", "id": 30 + i, "method": "tools/call",
                    "params": {"name": tool, "arguments": args},
                })
                response = adapter.recv()
                text = response["result"]["content"][0]["text"]
                assert text == "Não foi possível processar: sessão não encontrada."
        finally:
            adapter.close()
    finally:
        server.shutdown()


def test_new_tools_connectivity_failure_returns_generic_error():
    adapter = _make_adapter(port=1)  # ninguém escutando
    try:
        for i, (tool, args) in enumerate([
            ("editar_card", {"card_id": 1, "titulo": "X"}),
            ("excluir_card", {"card_id": 1}),
            ("ver_card", {"card_id": 1}),
            ("listar_cards", {}),
        ]):
            adapter.send({
                "jsonrpc": "2.0", "id": 40 + i, "method": "tools/call",
                "params": {"name": tool, "arguments": args},
            })
            response = adapter.recv(timeout=5.0)
            text = response["result"]["content"][0]["text"]
            assert "sucesso" not in text.lower()
            assert "não foi possível conectar" in text.lower()
    finally:
        adapter.close()
