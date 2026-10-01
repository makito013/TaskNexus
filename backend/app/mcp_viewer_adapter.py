"""Adaptador MCP standalone do visualizador de arquivos (Fase V, Parte 6 seção
6.4.6): ponte entre a tool `abrir_no_visualizador`, exposta ao `claude` (via
--mcp-config) e ao `codex` (via -c mcp_servers.*), e o backend FastAPI do
Escritório (POST /api/hooks/viewer/open).

Fase A (Parte 7 seção 7.4.5): o mesmo servidor expõe também
`publicar_artefato` (POST /api/hooks/artifacts/publish), que põe o arquivo
na aba Artefatos e, por padrão, abre no visualizador. Um servidor só para as
duas tools: um processo a menos por conversa e a mesma rota de callback.

O terminal não deixa o usuário clicar em links, então é por esta tool que o
agente MOSTRA um arquivo: o backend grava a aba e avisa a tela pelo WebSocket
do terminal, e o arquivo aparece no visualizador (inclusive no iPad).

Roda como PROCESSO FILHO do CLI do agente, não como parte do app FastAPI. Por
isso é stdlib pura, sem NENHUM import do resto de `app/` — mesmo esqueleto de
`mcp_card_adapter.py`: JSON-RPC 2.0 por linha sobre stdio (uma mensagem JSON
por linha em stdin, uma resposta por linha em stdout, com flush explícito) e
ESCRITORIO_CLAUDE_SESSION_ID via env var para o backend achar a sessão.

Como no adaptador de cards (e diferente do de tarefas), a resposta do backend
é repassada ao agente: "arquivo não encontrado", "fora do projeto" e "arquivo
protegido" são coisas que o agente precisa ler para corrigir o pedido. Só a
falha de conexão vira um texto genérico — sem travar e sem retry.

Compatibilidade: Python 3.9.6 — sem match/case, `X | Y` só em anotação.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.request

# Injetada pelo backend (main._escritorio_mcp_servers) com a porta/esquema
# reais do deploy. O fallback localhost:8000 só serve para rodar o adaptador à
# mão em dev, e é diferente da porta de produção para falhar cedo se a env var
# faltar.
HOOK_VIEWER_OPEN_URL = os.environ.get(
    "ESCRITORIO_HOOK_VIEWER_OPEN_URL", "http://localhost:8000/api/hooks/viewer/open"
)

# Mesma regra da URL acima, para `publicar_artefato` (Fase A).
HOOK_ARTIFACT_PUBLISH_URL = os.environ.get(
    "ESCRITORIO_HOOK_ARTIFACT_PUBLISH_URL",
    "http://localhost:8000/api/hooks/artifacts/publish",
)

# Contexto SSL que não valida certificado — seguro aqui porque a conexão é
# estritamente loopback (127.0.0.1). Necessário quando o deploy usa TLS: o
# cert é emitido para o hostname do Tailscale, não para 127.0.0.1.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

# O backend resolve projeto, caminho, banco e WebSocket antes de responder;
# 5 s cobre uma varredura de projetos lenta sem deixar o agente pendurado.
_TIMEOUT_SECONDS = 5

_CONNECTIVITY_ERROR_TEXT = "Não foi possível falar com o TaskNexus agora."

TOOL_ABRIR_NO_VISUALIZADOR = {
    "name": "abrir_no_visualizador",
    "description": (
        "Abre um arquivo do projeto no visualizador do TaskNexus, na tela do "
        "usuário (inclusive no iPad), numa aba nova. Use SEMPRE que criar ou "
        "alterar um arquivo que o usuário deva ler ou conferir (relatórios "
        ".html, documentos .md, planos, diagramas, trechos de código "
        "importantes) e sempre que o usuário pedir para ver, abrir ou mostrar "
        "um arquivo. O usuário não consegue clicar em links no terminal, então "
        "esta é a forma de mostrar arquivos a ele. Markdown aparece "
        "renderizado, HTML aparece como página, código aparece com destaque de "
        "sintaxe, e o usuário pode baixar o arquivo."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "caminho": {
                "type": "string",
                "description": (
                    "Caminho do arquivo, relativo à raiz do projeto (ex.: "
                    "docs/plano.md) ou absoluto dentro do projeto."
                ),
            },
            "titulo": {
                "type": "string",
                "description": "Opcional. Nome curto da aba. Padrão: nome do arquivo.",
            },
            "linha": {
                "type": "integer",
                "description": "Opcional. Linha para rolar e destacar (arquivos de código).",
            },
        },
        "required": ["caminho"],
    },
}

TOOL_PUBLICAR_ARTEFATO = {
    "name": "publicar_artefato",
    "description": (
        "Publica um arquivo como ARTEFATO do projeto na aba Artefatos do "
        "TaskNexus (organizada por cliente e projeto) e, por padrão, abre no "
        "visualizador do usuário. Use ao terminar um entregável que o usuário "
        "vai querer reencontrar depois: relatórios e páginas .html, "
        "documentos, planos e especificações .md, e arquivos .pdf. Se o "
        "arquivo já foi publicado, as informações são atualizadas. Arquivos "
        ".md, .html e .pdf abertos com abrir_no_visualizador também são "
        "publicados automaticamente."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "caminho": {
                "type": "string",
                "description": (
                    "Caminho do arquivo .md, .html ou .pdf, relativo à raiz do "
                    "projeto ou absoluto dentro dele."
                ),
            },
            "titulo": {
                "type": "string",
                "description": (
                    "Opcional. Título do artefato. Padrão: título do documento "
                    "ou nome do arquivo."
                ),
            },
            "descricao": {
                "type": "string",
                "description": "Opcional. Uma frase dizendo o que é o artefato.",
            },
            "abrir": {
                "type": "boolean",
                "description": "Opcional. Abre no visualizador do usuário. Padrão: true.",
            },
        },
        "required": ["caminho"],
    },
}

TOOLS = [TOOL_ABRIR_NO_VISUALIZADOR, TOOL_PUBLICAR_ARTEFATO]


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
            "serverInfo": {"name": "escritorio-visualizador", "version": "1.0.0"},
        },
    )


def _handle_tools_list(request: dict) -> dict:
    return _success_response(request.get("id"), {"tools": TOOLS})


def _post_json(url: str, body: dict):
    """POST JSON e devolve o corpo da resposta desserializado, ou None quando
    a requisição não completou (rede, timeout, corpo que não é JSON).

    Diferente do adaptador de cards, um status de erro HTTP com corpo JSON
    também é lido: o hook responde 403 com `{"success": false, "error": ...}`
    quando a chamada não vem da própria máquina, e essa explicação é mais útil
    ao agente do que "não foi possível falar com o TaskNexus"."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ctx = _SSL_CTX if url.startswith("https://") else None
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS, context=ctx) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read()
        except Exception:
            return None
    except Exception:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _format_result(result) -> str:
    """Corpo do hook -> texto que o agente lê (6.4.6).

    O caminho mostrado é o do item gravado (relativo e normalizado), não o que
    o agente mandou: se ele passou um caminho absoluto, a resposta confirma o
    arquivo que de fato abriu."""
    if result is None:
        return _CONNECTIVITY_ERROR_TEXT
    if result.get("success") is not True:
        return result.get("error") or _CONNECTIVITY_ERROR_TEXT
    item = result.get("item") or {}
    path = item.get("path") or "arquivo"
    if not result.get("delivered"):
        return (
            "Registrado no visualizador: {0}. O usuário verá ao abrir o "
            "TaskNexus.".format(path)
        )
    if result.get("reused"):
        return "Aberto no visualizador do usuário: {0} (aba já existia, foi atualizada).".format(path)
    return "Aberto no visualizador do usuário: {0} (aba nova).".format(path)


def _handle_abrir_no_visualizador(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "caminho": arguments.get("caminho"),
    }
    # Só entram no corpo quando vieram: o backend trata ausência como
    # "padrão" (nome do arquivo, sem linha).
    if arguments.get("titulo") is not None:
        body["titulo"] = arguments.get("titulo")
    if arguments.get("linha") is not None:
        body["linha"] = arguments.get("linha")
    return _format_result(_post_json(HOOK_VIEWER_OPEN_URL, body))


def _format_publish_result(result) -> str:
    """Corpo do hook de artefatos -> texto que o agente lê (7.4.5).

    O lugar na galeria é escrito como a tela mostra (`Artefatos › cliente /
    projeto`), para o agente poder dizer ao usuário onde achar o arquivo."""
    if result is None:
        return _CONNECTIVITY_ERROR_TEXT
    if result.get("success") is not True:
        return result.get("error") or _CONNECTIVITY_ERROR_TEXT
    artifact = result.get("artifact") or {}
    project_id = artifact.get("project_id") or ""
    place = " / ".join(part for part in project_id.split("/") if part) or "projeto"
    text = 'Artefato publicado em Artefatos \u203a {0}: "{1}" ({2})'.format(
        place, artifact.get("title") or artifact.get("path") or "arquivo",
        artifact.get("path") or "arquivo",
    )
    if result.get("created") is False:
        return text + " (já existia, foi atualizado)."
    return text + "."


def _handle_publicar_artefato(arguments: dict) -> str:
    body = {
        "claude_session_id": os.environ.get("ESCRITORIO_CLAUDE_SESSION_ID", ""),
        "caminho": arguments.get("caminho"),
    }
    # Só entram no corpo quando vieram: ausência = padrão do backend (título
    # do documento, sem descrição, abrir=true).
    for key in ("titulo", "descricao", "abrir"):
        if arguments.get(key) is not None:
            body[key] = arguments.get(key)
    return _format_publish_result(_post_json(HOOK_ARTIFACT_PUBLISH_URL, body))


def _handle_tools_call(request: dict) -> dict:
    params = request.get("params") or {}
    tool_name = params.get("name")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        arguments = {}

    if tool_name == TOOL_ABRIR_NO_VISUALIZADOR["name"]:
        text = _handle_abrir_no_visualizador(arguments)
    elif tool_name == TOOL_PUBLICAR_ARTEFATO["name"]:
        text = _handle_publicar_artefato(arguments)
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
    # Mesma razão de mcp_card_adapter.main(): no Windows, Python 3.9 decodifica
    # stdin/stdout de um pipe com a codepage local (cp1252), e um caminho com
    # acento chegaria corrompido. Tem que ser a primeira coisa: reconfigure()
    # falha depois que algum byte foi lido. errors="replace" no stdin impede
    # que um byte inválido derrube o adaptador pelo resto da sessão.
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
        if not isinstance(request, dict):
            continue
        try:
            response = _handle_request(request)
        except Exception as exc:
            response = _error_response(request.get("id"), -32603, "Internal error: {0}".format(exc))
        if response is not None:
            _write_message(response)


if __name__ == "__main__":
    main()
