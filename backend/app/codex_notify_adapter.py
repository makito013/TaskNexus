"""Adaptador standalone do `notify` do `codex` CLI — o equivalente do hook Stop
do `claude` para o Escritório de Agentes.

O `codex` chama um programa externo ao fim de cada turno do agente (config
`notify = [...]`, ver _build_codex_notify_argv em app/main.py), acrescentando UM
argumento final: o JSON do evento. Este script recebe

    [<python>, <este arquivo>, <session_id>, <hook_stop_url>, <codex json payload?>]

e faz um POST `{"session_id": <session_id>}` para <hook_stop_url> — o mesmo
corpo/endpoint que o hook Stop do `claude` usa para o backend marcar a conversa
como "terminou de responder" e notificar o iPad.

Roda como PROCESSO FILHO efêmero, spawnado pelo próprio `codex` DENTRO do turn
loop dele. Por isso:

- stdlib puro, SEM nenhum import de `app/` — não faz parte do processo FastAPI.
- Python 3.9.6 compat (sem match/case; anotações `X | Y` só sob
  `from __future__ import annotations`, declarado abaixo).
- NUNCA bloqueia e NUNCA falha: qualquer erro (porta morta, timeout, argv
  faltando, stdin ausente) é logado em stderr e o processo sai com código 0.
  Um exit != 0 aqui poderia fazer o `codex` tratar o notify como quebrado.

O payload do `codex` (chaves confirmadas contra o binário 0.153.2: `type`,
`thread-id`, `turn-id`, `cwd`, `client`, `input-messages`,
`last-assistant-message`) NÃO carrega o nosso session_id — a correlação é por
posição (argv[1]), não pelo conteúdo. O payload é usado SÓ para log.
"""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request

# Contexto SSL que não valida certificado. Só é usado quando a URL do callback
# começa com `https://` (ver _post_session_id) — nos caminhos normais o backend
# monta a URL como `http://127.0.0.1:<porta>` e este ctx nunca entra em jogo.
# Ele existe porque o deploy pode expor o backend atrás de TLS com um cert
# emitido para o hostname do Tailscale, não para 127.0.0.1, e a chamada continua
# indo para o loopback. O caso residual é um override explícito
# `HOOK_CALLBACK_BASE_URL=https://<host-remoto>`: aí o POST sai da máquina sem
# validar o cert e seria MITM-able. Isso é aceito pelo mesmo motivo que
# mcp_task_adapter.py / mcp_card_adapter.py aceitam — o payload é só um
# session_id opaco, o operador que seta esse override assume o trade-off, e o
# alvo default nunca deixa o loopback.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def _log(message: str) -> None:
    """Escreve em stderr sem nunca levantar (stderr pode estar fechado)."""
    try:
        sys.stderr.write("codex_notify_adapter: {0}\n".format(message))
        sys.stderr.flush()
    except Exception:
        pass


def _read_codex_payload(argv: list) -> dict:
    """Lê o JSON do evento do `codex`, só para log. Nunca levanta, nunca bloqueia.

    Duas fontes possíveis, nesta ordem:
    1. argv[-1], se parsear como um objeto JSON (é como o `codex` 0.153.2 passa).
    2. stdin, SÓ se não for um tty (um tty faria `read()` bloquear à espera de
       input que nunca vem — este processo roda dentro do turn loop do `codex`).
    """
    if len(argv) >= 4:
        try:
            parsed = json.loads(argv[-1])
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, TypeError):
            pass
    try:
        if sys.stdin is not None and not sys.stdin.isatty():
            raw = sys.stdin.read()
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
    except Exception:
        pass
    return {}


def _post_session_id(url: str, session_id: str) -> None:
    """POST fire-and-forget `{"session_id": session_id}`. Nunca levanta."""
    data = json.dumps({"session_id": session_id}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ctx = _SSL_CTX if url.startswith("https://") else None
    with urllib.request.urlopen(req, timeout=3, context=ctx) as resp:
        resp.read()


def main() -> int:
    # stdout/stderr em UTF-8 — defense in depth junto do PYTHONUTF8 que o spawn
    # já injeta. Envolto em try porque este processo pode ser spawnado sem
    # streams padrão utilizáveis; uma falha aqui não pode derrubar o notify.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    try:
        argv = sys.argv
        if len(argv) < 3:
            _log("argv insuficiente (esperado session_id e url); nada a fazer")
            return 0

        session_id = argv[1]
        hook_url = argv[2]

        # O POST é a única coisa que importa aqui e vem PRIMEIRO, antes de
        # qualquer leitura do payload: o `codex` spawna este processo fire-and-
        # forget e não há garantia sobre o stdin do filho (pode ser um pipe que
        # o `codex` nunca fecha, fazendo `read()` travar para sempre). Ler o
        # payload — que é só para log — depois do POST deixa a notificação de
        # fim de turno imune a qualquer escolha de stdio do `codex`.
        try:
            _post_session_id(hook_url, session_id)
        except Exception as exc:
            _log("POST para {0} falhou (ignorado): {1}".format(hook_url, exc))

        payload = _read_codex_payload(argv)
        if payload:
            _log(
                "evento codex type={0!r} thread-id={1!r} cwd={2!r}".format(
                    payload.get("type"),
                    payload.get("thread-id"),
                    payload.get("cwd"),
                )
            )
    except Exception as exc:
        _log("erro inesperado (ignorado): {0}".format(exc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
