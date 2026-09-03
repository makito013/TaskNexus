"""Adaptador MCP standalone: ponte entre as tools de card expostas ao `claude`
CLI (via --mcp-config) — `criar_card`, `mover_card`, `editar_card`,
`excluir_card`, `ver_card`, `listar_cards` — e o backend FastAPI do Escritório
(endpoints POST /api/hooks/cards/{create,move,update,delete,get,list}).

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
HOOK_UPDATE_URL = os.environ.get(
    "ESCRITORIO_HOOK_UPDATE_URL", "http://localhost:8000/api/hooks/cards/update"
)
HOOK_DELETE_URL = os.environ.get(
    "ESCRITORIO_HOOK_DELETE_URL", "http://localhost:8000/api/hooks/cards/delete"
)
HOOK_GET_URL = os.environ.get(
    "ESCRITORIO_HOOK_GET_URL", "http://localhost:8000/api/hooks/cards/get"
)
HOOK_LIST_URL = os.environ.get(
    "ESCRITORIO_HOOK_LIST_URL", "http://localhost:8000/api/hooks/cards/list"
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

# Manual copy of models.CARD_TIPOS: the literal list of valid tipo values
# announced in the inputSchema. This adapter is pure-stdlib Python 3.9 and runs
# as a child process of the `claude` CLI, so it cannot import from `app/` —
# hence the copy. When a 4th tipo is added, update models.CARD_TIPOS, this
# _TIPO_ENUM, and both assertions in test_mcp_card_adapter.py (criar_card and
# editar_card) together: a value forgotten here fails silently (the agent
# never gets it). Defined up here because TOOL_CRIAR_CARD already references it.
_TIPO_ENUM = ["bug", "hotfix", "historia"]

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
            "tipo": {
                "type": "string",
                "enum": _TIPO_ENUM,
                "description": (
                    "Campo informativo (bug/hotfix/historia). Não altera o "
                    "fluxo do agente."
                ),
            },
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

_STATUS_ENUM = ["a_fazer", "em_andamento", "em_revisao", "feito"]

TOOL_EDITAR_CARD = {
    "name": "editar_card",
    "description": (
        "Edita o conteúdo de um card existente: título, descrição, status "
        "e/ou tipo. Campos omitidos ficam inalterados; `tipo` com string "
        "vazia limpa o campo. Use para corrigir ou completar o texto de um "
        "card já criado. Só é possível editar cards do mesmo cliente da "
        "conversa atual — cards de outro cliente não podem ser editados."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "card_id": {"type": "integer"},
            "titulo": {"type": "string"},
            "descricao": {"type": "string"},
            "status": {"type": "string", "enum": _STATUS_ENUM},
            "tipo": {
                "type": "string",
                "enum": _TIPO_ENUM,
                "description": (
                    "Campo informativo (bug/hotfix/historia). Não altera o "
                    "fluxo do agente."
                ),
            },
        },
        "required": ["card_id"],
    },
}

TOOL_EXCLUIR_CARD = {
    "name": "excluir_card",
    "description": (
        "Exclui um card do board. Excluir um card de topo exclui junto os "
        "subcards dele. Só é possível excluir cards do mesmo cliente da "
        "conversa atual — cards de outro cliente não podem ser excluídos."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {"card_id": {"type": "integer"}},
        "required": ["card_id"],
    },
}

TOOL_VER_CARD = {
    "name": "ver_card",
    "description": (
        "Mostra os dados de um card específico pelo id (título, descrição, "
        "status, projeto, origem, datas). Use antes de editar para revisar o "
        "conteúdo atual. Só é possível consultar cards do mesmo cliente da "
        "conversa atual."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {"card_id": {"type": "integer"}},
        "required": ["card_id"],
    },
}

TOOL_LISTAR_CARDS = {
    "name": "listar_cards",
    "description": (
        "Lista os cards do board com seus ids, para descobrir o id de um card "
        "antes de vê-lo, editá-lo, movê-lo ou excluí-lo. Sem argumentos, "
        "lista os cards de TODOS os projetos do cliente da conversa atual; "
        "com projeto_id, lista só aquele projeto. Sempre restrito ao mesmo "
        "cliente da conversa atual — cards de outro cliente nunca aparecem."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "projeto_id": {
                "type": "string",
                "description": (
                    "ID do projeto do mesmo cliente cujos cards devem ser "
                    "listados. Se omitido, lista os cards de todos os "
                    "projetos do cliente."
                ),
            },
        },
        "required": [],
    },
}

TOOLS = [
    TOOL_CRIAR_CARD,
    TOOL_MOVER_CARD,
    TOOL_EDITAR_CARD,
    TOOL_EXCLUIR_CARD,
    TOOL_VER_CARD,
    TOOL_LISTAR_CARDS,
]


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
    """Traduz o corpo JSON de qualquer /api/hooks/cards/* para o texto que a
    tool devolve ao agente. `success: False` -> texto de erro de negócio
    (regra violada, permissão negada); `success: True` -> `success_text`;
    ausência da chave `success` (resposta {"status": "ok"} do no-op
    silencioso quando claude_session_id não resolve para uma session_key,
    mesmo padrão de hook_task/hook_stop) -> mensagem informativa, já que
    nenhum card foi de fato criado/alterado/consultado.

    Nas tools de consulta (ver_card/listar_cards) e no excluir_card, o
    `success_text` NÃO é uma frase fixa: o chamador o monta a partir do
    próprio payload (o card, a lista, a contagem de subcards) — é o payload
    que interessa ao agente, não a confirmação."""
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
        "tipo": arguments.get("tipo"),
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


def _handle_editar_card(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "card_id": arguments.get("card_id"),
        "titulo": arguments.get("titulo"),
        "descricao": arguments.get("descricao"),
        "status": arguments.get("status"),
        "tipo": arguments.get("tipo"),
    }
    result = _post_json(HOOK_UPDATE_URL, body)
    return _format_result(result, "Card editado com sucesso.")


def _handle_excluir_card(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "card_id": arguments.get("card_id"),
    }
    result = _post_json(HOOK_DELETE_URL, body)
    subcards = result.get("subcards_afetados") if isinstance(result, dict) else None
    success_text = "Card excluído com sucesso."
    if subcards:
        success_text += " {0} subcard(s) excluído(s) junto.".format(subcards)
    return _format_result(result, success_text)


def _handle_ver_card(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "card_id": arguments.get("card_id"),
    }
    result = _post_json(HOOK_GET_URL, body)
    card = result.get("card") if isinstance(result, dict) else None
    # O próprio payload é a resposta útil da tool — serializado como JSON
    # legível em vez de uma frase fixa de sucesso.
    success_text = (
        json.dumps(card, ensure_ascii=False, indent=2)
        if card is not None
        else "Card não encontrado."
    )
    return _format_result(result, success_text)


def _handle_listar_cards(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
    }
    # Só entra no corpo quando o agente informa de fato: mandar "" faria o
    # backend cair no ramo "usa o projeto da conversa atual" em vez de listar
    # o cliente inteiro (ver hook_cards_list).
    projeto_id = arguments.get("projeto_id")
    if projeto_id:
        body["projeto_id"] = projeto_id

    result = _post_json(HOOK_LIST_URL, body)
    cards = result.get("cards") if isinstance(result, dict) else None
    if cards:
        success_text = "{0} card(s) encontrado(s):\n{1}".format(
            len(cards), json.dumps(cards, ensure_ascii=False, indent=2)
        )
    else:
        # Lista vazia continua sendo sucesso (o backend devolve success=True
        # com cards=[]); _format_result só chega aqui nesse caso.
        success_text = "Nenhum card encontrado."
    return _format_result(result, success_text)


def _handle_tools_call(request: dict) -> dict:
    params = request.get("params") or {}
    tool_name = params.get("name")
    arguments = params.get("arguments") or {}

    if tool_name == TOOL_CRIAR_CARD["name"]:
        text = _handle_criar_card(arguments)
    elif tool_name == TOOL_MOVER_CARD["name"]:
        text = _handle_mover_card(arguments)
    elif tool_name == TOOL_EDITAR_CARD["name"]:
        text = _handle_editar_card(arguments)
    elif tool_name == TOOL_EXCLUIR_CARD["name"]:
        text = _handle_excluir_card(arguments)
    elif tool_name == TOOL_VER_CARD["name"]:
        text = _handle_ver_card(arguments)
    elif tool_name == TOOL_LISTAR_CARDS["name"]:
        text = _handle_listar_cards(arguments)
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
    # Python 3.9 on Windows decodes stdin/stdout with locale.getpreferredencoding()
    # (cp1252/cp850) instead of UTF-8 when the stream is a pipe (not a real
    # console) — which is exactly how the `claude` CLI spawns this adapter.
    # Must be the very first statement in main(): reconfigure() raises
    # io.UnsupportedOperation once any byte has already been consumed from the
    # stream. errors="replace" on stdin is load-bearing, not cosmetic — the
    # decode happens in the `for line in sys.stdin:` loop below, outside the
    # try/except around json.loads(); without it, a single invalid byte raises
    # UnicodeDecodeError there and kills the adapter process silently for the
    # rest of the session.
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8")
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
