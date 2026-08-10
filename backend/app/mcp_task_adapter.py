"""Adaptador MCP standalone: ponte entre a tool `criar_tarefa_validacao`
exposta ao `claude` CLI (via --mcp-config) e o backend FastAPI do Escritório.

Roda como PROCESSO FILHO do `claude` CLI (subprocess separado do backend
FastAPI, spawnado pelo próprio CLI a partir do comando/args em
_build_mcp_config_json em app/main.py), não como parte do app FastAPI.
Por isso é stdlib puro, sem NENHUM import do resto de `app/` — não pode
depender de nada que só exista dentro do processo do backend.

Protocolo: JSON-RPC 2.0 line-delimited sobre stdio (uma mensagem JSON por
linha em stdin, uma resposta JSON por linha em stdout, com flush()
explícito — o `claude` CLI lê stdout linha a linha).

Compatibilidade: ambiente roda Python 3.9.6 — sem match/case, sem `X | Y`
em anotação de runtime (só sob `from __future__ import annotations`, que
está declarado abaixo e cobre isso).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

# Sobrescrevível via env var para permitir testar contra um http.server
# efêmero local, sem precisar levantar o backend real em localhost:8000.
HOOK_URL = os.environ.get("ESCRITORIO_HOOK_URL", "http://localhost:8000/api/hooks/task")

TOOL_NAME = "criar_tarefa_validacao"

_CONNECTIVITY_ERROR_TEXT = (
    "Não foi possível conectar ao backend do Escritório para criar a tarefa."
)

TOOL_SCHEMA = {
    "name": TOOL_NAME,
    "description": (
        "Cria uma tarefa de validação para o usuário revisar no Escritório "
        "de Agentes. Use quando pedir explicitamente para o usuário validar "
        "algo (ex: revisar uma decisão, aprovar um resultado)."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "titulo": {"type": "string", "description": "Título curto da tarefa."},
            "descricao_markdown": {
                "type": "string",
                "description": "Descrição da tarefa em markdown.",
            },
            "descricao_html": {
                "type": "string",
                "description": "Descrição opcional em HTML, se markdown não for suficiente.",
            },
            "projeto_id": {
                "type": "string",
                "description": (
                    "ID do sub-projeto do mesmo cliente onde deve ser criado, "
                    "se diferente do projeto da conversa atual. Se omitido, usa "
                    "o projeto da conversa atual."
                ),
            },
        },
        "required": ["titulo", "descricao_markdown"],
    },
}


def _write_message(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def _success_response(request_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error_response(request_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _handle_initialize(request: dict) -> dict:
    params = request.get("params") or {}
    protocol_version = params.get("protocolVersion", "2024-11-05")
    return _success_response(
        request.get("id"),
        {
            "protocolVersion": protocol_version,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "escritorio-tarefas", "version": "1.0.0"},
        },
    )


def _handle_tools_list(request: dict) -> dict:
    return _success_response(request.get("id"), {"tools": [TOOL_SCHEMA]})


def _post_json(url: str, body: dict):
    """POST JSON via urllib e retorna o corpo da resposta já desserializado.

    Mesma forma do `_post_json` de mcp_card_adapter.py (deliberado — este
    adapter ANTES era fire-and-forget cego: sempre respondia "Tarefa de
    validação criada." mesmo quando o backend rejeitava a criação, tornando
    invisível ao agente qualquer erro de negócio, como a validação
    "mesmo cliente" do projeto_id. Agora ele lê o corpo da resposta
    (`{success, error}` / `{status: ok}`) para reportar o resultado real.
    Só retorna None quando a requisição genuinamente não pôde ser completada
    (rede/timeout) ou a resposta não é JSON válido — tratado como falha de
    conectividade, nunca como sucesso silencioso."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = resp.read()
        return json.loads(raw)
    except Exception:
        return None


def _format_result(result, success_text: str) -> str:
    """Traduz o corpo JSON de /api/hooks/task para o texto que a tool devolve
    ao agente. `success: False` -> texto de erro de negócio (ex: projeto de
    outro cliente, projeto inexistente); `success: True` -> texto de sucesso;
    ausência da chave `success` (resposta {"status": "ok"} do no-op silencioso
    quando claude_session_id não resolve para uma session_key) -> mensagem
    informativa, já que nenhuma tarefa foi de fato criada. Mesmo formato do
    _format_result de mcp_card_adapter.py."""
    if result is None:
        return _CONNECTIVITY_ERROR_TEXT
    if result.get("success") is False:
        return result.get("error") or "Erro desconhecido ao criar a tarefa."
    if result.get("success") is True:
        return success_text
    return "Não foi possível criar a tarefa: sessão não encontrada."


def _handle_criar_tarefa(arguments: dict) -> str:
    # `**arguments` repassa titulo/descricao_markdown/descricao_html e,
    # quando presente, projeto_id — campo opcional (Tarefa 6): o backend
    # aplica a validação "mesmo cliente" e devolve {success, error}.
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        **arguments,
    }
    result = _post_json(HOOK_URL, body)
    return _format_result(result, "Tarefa de validação criada.")


def _handle_tools_call(request: dict) -> dict:
    params = request.get("params") or {}
    tool_name = params.get("name")
    arguments = params.get("arguments") or {}

    if tool_name == TOOL_NAME:
        text = _handle_criar_tarefa(arguments)
    else:
        text = "Tool desconhecida: {0}".format(tool_name)

    return _success_response(
        request.get("id"),
        {"content": [{"type": "text", "text": text}]},
    )


def _handle_request(request: dict) -> dict | None:
    method = request.get("method")
    has_id = "id" in request

    if method == "initialize":
        return _handle_initialize(request)
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return _handle_tools_list(request)
    if method == "tools/call":
        return _handle_tools_call(request)

    if has_id:
        return _error_response(request.get("id"), -32601, "Method not found: {0}".format(method))
    return None


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            response = _handle_request(request)
        except Exception as exc:
            response = _error_response(request.get("id"), -32603, "Internal error: {0}".format(exc))
        if response is not None:
            _write_message(response)


if __name__ == "__main__":
    main()
