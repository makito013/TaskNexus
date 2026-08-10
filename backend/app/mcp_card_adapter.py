"""Adaptador MCP standalone: ponte entre as tools `criar_card`/`mover_card`
expostas ao `claude` CLI (via --mcp-config) e o backend FastAPI do Escritório
(endpoints POST /api/hooks/cards/create e POST /api/hooks/cards/move).

Roda como PROCESSO FILHO do `claude` CLI (subprocess separado do backend
FastAPI, spawnado pelo próprio CLI a partir do comando/args em
_build_mcp_config_json em app/main.py), não como parte do app FastAPI.
Por isso é stdlib puro, sem NENHUM import do resto de `app/` — não pode
depender de nada que só exista dentro do processo do backend. Mesmo esqueleto
de `mcp_task_adapter.py` (JSON-RPC 2.0 line-delimited sobre stdio, leitura de
ESCRITORIO_CLAUDE_SESSION_ID via env var).

Protocolo: JSON-RPC 2.0 line-delimited sobre stdio (uma mensagem JSON por
linha em stdin, uma resposta JSON por linha em stdout, com flush() explícito
— o `claude` CLI lê stdout linha a linha).

Diferença deliberada em relação a `mcp_task_adapter.py`: aquele adapter é
fire-and-forget silencioso (a tool sempre responde "tarefa criada", mesmo se
o POST falhar). Aqui NÃO — 05-ARQUITETO.md seção 3 exige que uma violação de
regra de negócio (permissão negada, pai inexistente, etc.) seja comunicada de
volta ao agente como texto legível, porque o backend processou a requisição e
a rejeitou por uma razão real, não porque a sessão sumiu. Por isso o adapter
lê e repassa o corpo da resposta HTTP (`{success, error}` / `{success,
card_id}`) em vez de ignorá-lo. Só uma falha genuína de conectividade (POST
que nem completa) continua tolerante — não trava esperando retry, mas também
não finge sucesso: retorna um erro genérico de conectividade como resultado
da tool.

Compatibilidade: ambiente roda Python 3.9.6 — sem match/case, sem `X | Y` em
anotação de runtime (só sob `from __future__ import annotations`, que está
declarado abaixo e cobre isso).
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.request

# Sobrescrevíveis via env var — o backend (main.py, _build_mcp_config_json)
# injeta as URLs corretas com base na porta/esquema reais do deploy. O
# fallback localhost:8000 existe só para rodar o adapter manualmente em dev
# (sem deploy.ps1), e é intencionalmente diferente da porta de produção para
# falhar cedo se as env vars não estiverem configuradas.
HOOK_CREATE_URL = os.environ.get(
    "ESCRITORIO_HOOK_CREATE_URL", "http://localhost:8000/api/hooks/cards/create"
)
HOOK_MOVE_URL = os.environ.get(
    "ESCRITORIO_HOOK_MOVE_URL", "http://localhost:8000/api/hooks/cards/move"
)

# Contexto SSL que não valida certificado — seguro aqui porque a conexão é
# estritamente loopback (127.0.0.1). Necessário quando o deploy usa TLS: o
# cert é emitido para o hostname do Tailscale, não para 127.0.0.1.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

_CONNECTIVITY_ERROR_TEXT = (
    "Não foi possível conectar ao backend do Escritório para processar esta ação."
)

TOOL_CRIAR_CARD = {
    "name": "criar_card",
    "description": (
        "Cria um card de tarefa no board do Escritório para o projeto atual. "
        "Use para registrar trabalho a fazer que o usuário deve acompanhar "
        "fora do chat. NÃO cria diretamente em 'Feito' — use 'a_fazer' ou "
        "'em_andamento'. Pode opcionalmente ser criado como subtarefa de um "
        "card existente via parent_id."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "titulo": {"type": "string"},
            "status": {"type": "string", "enum": ["a_fazer", "em_andamento"]},
            "descricao": {"type": "string"},
            "parent_id": {"type": "integer"},
            "projeto_id": {
                "type": "string",
                "description": (
                    "ID do sub-projeto do mesmo cliente onde deve ser criado, "
                    "se diferente do projeto da conversa atual. Se omitido, usa "
                    "o projeto da conversa atual."
                ),
            },
        },
        "required": ["titulo"],
    },
}

TOOL_MOVER_CARD = {
    "name": "mover_card",
    "description": (
        "Move um card para outra coluna do board, inclusive para 'feito'. "
        "Qualquer agente pode mover qualquer card — não importa quem o criou "
        "— desde que o card pertença ao mesmo cliente da conversa atual. "
        "Cards de outro cliente não podem ser movidos."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "card_id": {"type": "integer"},
            "novo_status": {
                "type": "string",
                "enum": ["a_fazer", "em_andamento", "em_revisao", "feito"],
            },
        },
        "required": ["card_id", "novo_status"],
    },
}

TOOLS = [TOOL_CRIAR_CARD, TOOL_MOVER_CARD]


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
            "serverInfo": {"name": "escritorio-cards", "version": "1.0.0"},
        },
    )


def _handle_tools_list(request: dict) -> dict:
    return _success_response(request.get("id"), {"tools": TOOLS})


def _post_json(url: str, body: dict):
    """POST JSON via urllib e retorna o corpo da resposta já desserializado.

    Diferente do `_post_task` fire-and-forget de mcp_task_adapter.py: aqui o
    chamador PRECISA do corpo da resposta (`{success, error}` /
    `{success, card_id}`) para decidir o que reportar ao agente. Só retorna
    None quando a requisição genuinamente não pôde ser completada (erro de
    rede/timeout) ou a resposta não é JSON válido — nesses casos o chamador
    trata como falha de conectividade, nunca como sucesso silencioso.
    """
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        ctx = _SSL_CTX if url.startswith("https://") else None
        with urllib.request.urlopen(req, timeout=3, context=ctx) as resp:
            raw = resp.read()
        return json.loads(raw)
    except Exception:
        return None


def _format_result(result, success_text: str) -> str:
    """Traduz o corpo JSON de /api/hooks/cards/create|move para o texto que a
    tool devolve ao agente. `success: False` -> texto de erro de negócio
    (regra violada, permissão negada); `success: True` -> texto de sucesso;
    ausência da chave `success` (resposta {"status": "ok"} do no-op
    silencioso quando claude_session_id não resolve para uma session_key,
    mesmo padrão de hook_task/hook_stop) -> mensagem informativa, já que
    nenhum card foi de fato criado/movido."""
    if result is None:
        return _CONNECTIVITY_ERROR_TEXT
    if result.get("success") is False:
        return result.get("error") or "Erro desconhecido ao processar o card."
    if result.get("success") is True:
        return success_text
    return "Não foi possível processar: sessão não encontrada."


def _handle_criar_card(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "titulo": arguments.get("titulo"),
        "status": arguments.get("status", "a_fazer"),
        "descricao": arguments.get("descricao"),
        "parent_id": arguments.get("parent_id"),
        # Opcional (Tarefa 6): sub-projeto do mesmo cliente. Só entra no corpo
        # quando o agente informa — omitido -> backend usa o projeto da
        # conversa atual (derivado da session_key).
        "projeto_id": arguments.get("projeto_id"),
    }
    result = _post_json(HOOK_CREATE_URL, body)
    card_id = result.get("card_id") if isinstance(result, dict) else None
    success_text = (
        "Card criado com sucesso (id {0}).".format(card_id)
        if card_id is not None
        else "Card criado com sucesso."
    )
    return _format_result(result, success_text)


def _handle_mover_card(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "card_id": arguments.get("card_id"),
        "novo_status": arguments.get("novo_status"),
    }
    result = _post_json(HOOK_MOVE_URL, body)
    return _format_result(result, "Card movido com sucesso.")


def _handle_tools_call(request: dict) -> dict:
    params = request.get("params") or {}
    tool_name = params.get("name")
    arguments = params.get("arguments") or {}

    if tool_name == TOOL_CRIAR_CARD["name"]:
        text = _handle_criar_card(arguments)
    elif tool_name == TOOL_MOVER_CARD["name"]:
        text = _handle_mover_card(arguments)
    else:
        text = "Tool desconhecida: {0}".format(tool_name)

    return _success_response(
        request.get("id"),
        {"content": [{"type": "text", "text": text}]},
    )


def _handle_request(request: dict):
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
