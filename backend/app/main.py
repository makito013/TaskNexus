from __future__ import annotations

import os
import json
import mimetypes
import socket
import sys
import time
import uuid
import asyncio
import uvicorn
from typing import TypedDict
from contextlib import asynccontextmanager, contextmanager
from fastapi import (
    FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException,
    Query, UploadFile, File,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from pydantic import ValidationError
from dotenv import load_dotenv
from app.conversation_store import ConversationStore
from app.task_store import TaskStore
from app.agent_store import GlobalAgentStore
from app.card_store import CardStore, ColumnDeleteError
from app.settings_store import SettingsStore
from app.push_store import PushSubscriptionStore, TooManySubscriptionsError
from app.push_payload import build_push_payload
from app.push_service import send_push_to_all
from app.vapid_keys import load_or_create_vapid_keys
from app.image_validation import sniff_image_type, UploadTooLargeError, validate_upload_stream
from app.agent_discovery import scan_projects, resolve_projeto_alvo, cliente_id_from_projeto_id
from app.asyncio_patches import install_proactor_connection_lost_patch
from app.attachments import list_attachments, save_attachments, delete_attachment
from app.logging_filters import install_benign_transfer_error_filter
from app.pty_manager import PTYManager
from app.session_provisioner import provision_session_id
from app.quiet_hours import current_utc_offset_minutes, is_within_quiet_hours
from app.models import (
    CARD_TIPOS,
    InitFrame,
    ResizeFrame,
    RenameFrame,
    Project,
    Agent,
    TaskCreateRequest,
    Task,
    TaskGlobal,
    HookTaskRequest,
    Card,
    CardImage,
    CardCreateRequest,
    SubcardCreateRequest,
    CardUpdateRequest,
    BoardColumn,
    BoardColumnCreateRequest,
    BoardColumnUpdateRequest,
    BoardColumnReorderRequest,
    LimparConcluidosResult,
    HookCardCreateRequest,
    HookCardMoveRequest,
    HookCardUpdateRequest,
    HookCardDeleteRequest,
    HookCardGetRequest,
    HookCardListRequest,
    AppearanceSettings,
    AppearanceUpdateRequest,
    NotificationSettings,
    NotificationSettingsUpdateRequest,
    PushSubscriptionRequest,
    PushSubscriptionDeleteRequest,
    VapidPublicKeyResponse,
    ProjectsRootSettings,
    ProjectsRootUpdateRequest,
    AttachmentUploadResult,
    PasteRequest,
)

load_dotenv()

PROJECTS_ROOT = os.getenv("PROJECTS_ROOT", os.path.expanduser("~/projetos"))
SESSIONS_DB = os.getenv("SESSIONS_DB", "sessions.db")
# Serve o build de produção do frontend (`npm run build` em frontend/) direto
# pelo FastAPI — um processo só, uma porta só, sem depender do Vite dev server
# em uso contínuo. Se `dist/` não existir (fluxo de dev normal, Vite dev
# server + proxy do vite.config.js), o mount é pulado e nada muda.
# Accepts an env var override (same pattern as BOARD_UPLOADS_ROOT below)
# to allow deterministic integration tests against a temporary dist/,
# without depending on running `npm run build` before the suite.
FRONTEND_DIST = os.getenv(
    "FRONTEND_DIST",
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"),
)
# Diretório onde as imagens de cards são gravadas em disco (Tarefa 6,
# 05-ARQUITETO.md seção 2/5.3). Resolvido a partir de __file__ (mesmo
# espírito de FRONTEND_DIST), não do CWD — mas, diferente de FRONTEND_DIST,
# aceita override via env var para permitir isolamento total em testes de
# integração (mesmo padrão de SESSIONS_DB acima), sem escrever no
# board_uploads/ real do repo.
BOARD_UPLOADS_ROOT = os.getenv(
    "BOARD_UPLOADS_ROOT",
    os.path.join(os.path.dirname(__file__), "..", "board_uploads"),
)

# --- Canal de callback dos hooks (Fase 0) -----------------------------------
#
# O hook `Stop` do Claude Code e os adaptadores MCP falam com ESTE backend por
# HTTP, e até aqui a URL era `http://localhost:8000` hardcoded. Isso só funciona
# no fluxo de dev: em produção o deploy.ps1 sobe UMA instância uvicorn na 443
# (ou na 80 com -NoTls), então nada escutava na 8000 e o canal de hooks estava
# morto justamente no ambiente real — sem needs_attention, sem tarefa criada por
# MCP, sem nada.
#
# A saída é um SEGUNDO listener uvicorn dentro deste mesmo processo, preso a
# 127.0.0.1 e servindo o mesmo app: a porta do canal de hooks fica desacoplada
# da porta pública sem expor nada a mais na rede/tailnet (hook e adaptadores
# rodam sempre na mesma máquina que o backend).
#
# Ele nasce DESLIGADO e só sobe quando HOOK_LOOPBACK_PORT está setada. Ligado
# por padrão, toda suíte que levanta o app via TestClient passaria a ocupar uma
# porta fixa — quebrando execuções concorrentes e qualquer máquina onde essa
# porta já esteja em uso.
HOOK_LOOPBACK_HOST = "127.0.0.1"
# Porta usada na URL dos hooks quando NÃO há listener de loopback configurado:
# o fluxo de dev e o deploy.sh, em que o próprio app principal responde na 8000.
DEFAULT_HOOK_PORT = 8000

store = ConversationStore(db_path=SESSIONS_DB)
task_store = TaskStore(db_path=SESSIONS_DB)
agent_store = GlobalAgentStore(db_path=SESSIONS_DB)
card_store = CardStore(db_path=SESSIONS_DB)
settings_store = SettingsStore(db_path=SESSIONS_DB)
push_store = PushSubscriptionStore(db_path=SESSIONS_DB)
pty_manager = PTYManager()

# VAPID keypair provisioned at boot (decision G-1). None = push unavailable
# on this machine (dependency missing / provisioning failed) — every push
# path checks it and degrades to a no-op, nothing else is affected.
_vapid_keys = None

# Strong references to in-flight push broadcasts. asyncio only holds a WEAK
# reference to a running task, so a fire-and-forget create_task() can be
# garbage-collected mid-flight and the push silently never leaves (Risk R-3).
_push_tasks: set[asyncio.Task] = set()
_session_locks: dict[str, asyncio.Lock] = {}
# Quantos callers estão DENTRO de `_session_lock` para cada chave — contando
# tanto quem já segura o lock quanto quem está na fila esperando por ele. É o
# refcount que autoriza a remoção da entrada de `_session_locks` (ver
# `_session_lock` para o porquê de não dar para usar `lock.locked()` no lugar).
_session_lock_users: dict[str, int] = {}
_global_agents_cache: list[Agent] = []
_active_connections: dict[str, WebSocket] = {}
_disconnect_times: dict[str, float] = {}
_active_tasks: dict[str, asyncio.Task] = {}
# 30 min, up from 5 (was too tight for a phone lock: mobile browsers can
# discard a backgrounded tab in a normal (non-PWA) window before the user
# reopens it, so a full page reload past this delay lost the live PTY and
# leaned on the persisted-session --resume fallback (TerminalContext.jsx)
# for every mid-length lock instead of just the long ones.
CLEANUP_DELAY = float(os.getenv("CLEANUP_DELAY", "1800.0"))
ACTIVITY_TIMEOUT = float(os.getenv("ACTIVITY_TIMEOUT", "5.0"))


def _pretrust_projects() -> None:
    """Best-effort: mark every discoverable project as trust-accepted in
    ~/.claude.json so the workspace trust prompt never blocks PTY startup
    (RESEARCH.md Pitfall 5). Never allowed to block app startup.

    Writes atomically (temp file + os.replace): this file is also written
    directly by the `claude` CLI itself, and can be touched by more than one
    instance of this backend at once (e.g. during a service→deploy.ps1
    transition, or two overlapping runs). A plain `open(config_path, "w")`
    here truncates and writes in place — if a concurrent writer's shorter
    document finishes writing after this one already flushed a longer one,
    the leftover tail bytes from the stale write corrupt the file with
    trailing garbage (confirmed in practice: `json.loads` failing with
    "Extra data" partway through). `os.replace` swaps the whole file in one
    step, so no reader or writer ever observes a partial/mixed result.

    Path overridable via CLAUDE_CONFIG_PATH (same override pattern as
    PROJECTS_ROOT/SESSIONS_DB above) — every integration test that spins up
    the app via TestClient triggers this function through the real
    `lifespan`, and without this override it was silently reading and
    rewriting the developer's actual ~/.claude.json on every single test
    run, accumulating thousands of stale pytest-tmp-path "projects" entries
    over time (confirmed in practice: 11,743 of 11,808 entries in one such
    file were leftover pytest tmp_path garbage).
    """
    try:
        config_path = os.getenv("CLAUDE_CONFIG_PATH", os.path.expanduser("~/.claude.json"))
        with open(config_path, "r") as f:
            data = json.load(f)
        changed = False
        # Só pré-aceita o trust do `claude` para projetos que realmente têm
        # `.claude/`. Desde que `.codex/` (e antes `.gemini/`) passou a tornar
        # um projeto elegível, scan_projects() também devolve projetos sem
        # `.claude/` nenhum; gravar `hasTrustDialogAccepted: true` para eles
        # apagaria em silêncio a única confirmação de trust do `claude` para
        # repositórios que ele nunca abriu. O `codex` não expõe um mecanismo de
        # pre-trust via `-c` (medido contra o binário real: o override
        # `projects.<cwd>.trust_level` parseia mas o gate de trust da TUI não o
        # consulta) — a única forma de suprimir o prompt de trust da TUI é uma
        # entrada on-disk em `~/.codex/config.toml`, que o TaskNexus
        # deliberadamente não escreve (ADR: codex é agente de argv). O usuário
        # responde o prompt de trust da TUI (um PTY real) na primeira vez que
        # abre cada projeto com o `codex`, e o próprio codex persiste depois —
        # não lê este arquivo.
        for proj in scan_projects(PROJECTS_ROOT):
            if not os.path.isdir(os.path.join(proj.path, ".claude")):
                continue
            entry = data.setdefault("projects", {}).setdefault(proj.path, {})
            if not entry.get("hasTrustDialogAccepted"):
                entry["hasTrustDialogAccepted"] = True
                changed = True
        if changed:
            tmp_path = f"{config_path}.tmp-{os.getpid()}"
            with open(tmp_path, "w") as f:
                json.dump(data, f)
            os.replace(tmp_path, config_path)
    except Exception:
        return


def normalize_cross_platform_path(path: str | None) -> str | None:
    if not path:
        return path
    path_str = str(path).strip()
    if sys.platform == "win32":
        if path_str.startswith("/mnt/") and len(path_str) >= 6 and path_str[6:7] in ("/", "\\", ""):
            drive_letter = path_str[5:6].upper()
            rest = path_str[6:].replace("/", "\\")
            return f"{drive_letter}:{rest}"
    else:
        if len(path_str) >= 2 and path_str[1] == ":" and path_str[0].isalpha():
            drive_letter = path_str[0].lower()
            rest = path_str[2:].replace("\\", "/")
            return f"/mnt/{drive_letter}{rest}"
    return path_str


def _resolve_projects_root_value(settings: dict) -> str:
    raw = settings.get("projects_root_path") or os.getenv("PROJECTS_ROOT") or os.path.expanduser("~/projetos")
    normalized = normalize_cross_platform_path(raw)
    if normalized and os.path.isdir(normalized):
        return normalized
    if raw and os.path.isdir(raw):
        return raw
    return normalized or raw or os.path.expanduser("~/projetos")


async def _reload_projects_root() -> None:
    global PROJECTS_ROOT
    PROJECTS_ROOT = _resolve_projects_root_value(await settings_store.get())


def _pick_projects_folder() -> str | None:
    """Abre o seletor de pasta nativo do SO. Import de tkinter fica DENTRO
    da função (não no topo do módulo) — evita exigir Tk disponível em
    ambientes de teste/CI headless que nunca chamam esta função de verdade
    (sempre mockada em teste, ver test_settings_endpoints.py)."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askdirectory()
    root.destroy()
    return path or None


def _hook_loopback_port() -> int | None:
    """Porta do listener de loopback de hooks, ou None quando desligado.

    Um valor inválido NÃO derruba o boot: vira aviso e "desligado". O backend
    inteiro não pode deixar de subir por causa da configuração de um canal
    auxiliar.
    """
    raw = os.getenv("HOOK_LOOPBACK_PORT", "").strip()
    if not raw:
        return None
    try:
        port = int(raw)
    except ValueError:
        print(
            f"==> AVISO: HOOK_LOOPBACK_PORT={raw!r} não é um número inteiro — "
            f"canal de hooks desligado.",
            flush=True,
        )
        return None
    if not 0 < port < 65536:
        print(
            f"==> AVISO: HOOK_LOOPBACK_PORT={port} fora da faixa 1-65535 — "
            f"canal de hooks desligado.",
            flush=True,
        )
        return None
    return port


def _hook_callback_base_url() -> str:
    """URL base que o hook Stop e os adaptadores MCP usam para chamar de volta.

    Aponta para o listener de loopback quando ele existe E está de fato no ar
    (`_hook_loopback_server is not None`); senão mantém o comportamento
    histórico (porta do app principal em dev/deploy.sh). Checar o objeto do
    servidor, e não só a config (`_hook_loopback_port()`), importa porque o
    pré-bind do socket (`_bind_hook_loopback_socket`) pode falhar — porta já
    ocupada, por exemplo — sem derrubar o processo: nesse caso
    `_hook_loopback_server` continua None mesmo com HOOK_LOOPBACK_PORT setada,
    e apontar para essa porta entregaria aos CLIs/hooks uma URL de callback
    morta, sem nada escutando do outro lado.

    Literal `127.0.0.1` em vez de `localhost` de propósito: o listener binda só
    IPv4, e em Windows `localhost` pode resolver para ::1 primeiro.

    HOOK_CALLBACK_BASE_URL existe para o caso em que o backend está atrás de
    outra coisa (proxy, container) e nenhuma das duas heurísticas serve — mesmo
    padrão de override por env var que os adaptadores MCP já usam.
    """
    explicit = os.getenv("HOOK_CALLBACK_BASE_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = _hook_loopback_port() if _hook_loopback_server is not None else None
    return f"http://{HOOK_LOOPBACK_HOST}:{port or DEFAULT_HOOK_PORT}"


class _DetachedSignalsServer(uvicorn.Server):
    """uvicorn.Server que NÃO mexe nos handlers de sinal do processo.

    `Server.serve()` embrulha tudo em `capture_signals()`, que troca os handlers
    de SIGINT/SIGTERM do processo pelos DESTA instância (e ainda re-emite o
    sinal capturado ao sair). Numa segunda instância vivendo dentro do processo
    do servidor principal isso é destrutivo: o Ctrl+C do deploy.ps1 passaria a
    parar apenas o listener de loopback, deixando o servidor principal de pé.
    Só o servidor principal pode controlar o ciclo de vida do processo.

    Sobrescreve `capture_signals` e não `install_signal_handlers`: este último
    não existe mais no uvicorn 0.30.6 (virou justamente este context manager),
    então um override daquele nome seria um no-op silencioso.
    """

    @contextmanager
    def capture_signals(self):
        yield


# Servidor e task do listener de loopback enquanto ele está no ar (None quando
# desligado). Guardados no módulo porque o shutdown do lifespan precisa
# encontrá-los para pará-lo antes dos stores.
_hook_loopback_server: uvicorn.Server | None = None
_hook_loopback_task: asyncio.Task | None = None


def _bind_hook_loopback_socket(port: int) -> socket.socket | None:
    """Pré-binda o socket do listener de hooks; devolve None se o bind falhar.

    O bind é feito aqui, e não pelo uvicorn, de propósito: quando o uvicorn abre
    o socket sozinho e o bind falha (porta ocupada, tipicamente uma instância
    anterior ainda de pé), ele chama `sys.exit(1)` — matando o processo do
    servidor PRINCIPAL. Entregando um socket já pronto para
    `Server.serve(sockets=[...])`, esse ramo do uvicorn nunca é alcançado e a
    falha vira um aviso: fica sem canal de hooks, mas com o backend no ar.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # SO_REUSEADDR só em POSIX, onde ele apenas permite reusar uma porta em
        # TIME_WAIT. No Windows a mesma flag permite DOIS binds simultâneos e
        # ativos na mesma porta, o que transformaria "porta já ocupada" — o caso
        # que este código precisa justamente detectar — em sucesso silencioso.
        if os.name != "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((HOOK_LOOPBACK_HOST, port))
        sock.listen(128)
    except OSError as exc:
        sock.close()
        print(
            f"==> AVISO: não consegui abrir o canal de hooks em "
            f"{HOOK_LOOPBACK_HOST}:{port} ({exc}). O backend segue no ar, mas o "
            f"hook Stop e os adaptadores MCP não vão conseguir chamar de volta.",
            flush=True,
        )
        return None
    return sock


async def _start_hook_loopback_listener() -> None:
    """Sobe o listener de loopback de hooks (no-op sem HOOK_LOOPBACK_PORT).

    Chamado no FIM do startup do lifespan, depois dos stores: o socket começa a
    aceitar conexões no instante em que é criado, e um hook atendido antes do
    `initialize()` bateria em banco não inicializado.
    """
    global _hook_loopback_server, _hook_loopback_task
    port = _hook_loopback_port()
    if port is None:
        return
    sock = _bind_hook_loopback_socket(port)
    if sock is None:
        return
    config = uvicorn.Config(
        app,
        # O lifespan é do servidor principal. Rodá-lo de novo aqui
        # reinicializaria stores e subiria um segundo listener recursivamente.
        lifespan="off",
        # Config.configure_logging() mexe em loggers GLOBAIS, então este bloco
        # existe para o segundo servidor não reconfigurar o logging do primeiro:
        # sem log_config=None ele roda dictConfig() e troca handlers/níveis dos
        # loggers do uvicorn DEPOIS de install_benign_transfer_error_filter().
        # Pelo mesmo motivo, nada de log_level (sobrescreveria o nível do
        # servidor principal) nem de access_log=False (esvazia os handlers de
        # `uvicorn.access` no processo inteiro, matando o access log do
        # servidor principal junto — confirmado em config.py:391).
        log_config=None,
        # Default é None (= esperar para sempre): uma conexão presa aqui
        # travaria o shutdown do processo inteiro.
        timeout_graceful_shutdown=5,
    )
    server = _DetachedSignalsServer(config)
    _hook_loopback_server = server
    _hook_loopback_task = asyncio.create_task(server.serve(sockets=[sock]))
    print(
        f"==> Canal de hooks escutando em http://{HOOK_LOOPBACK_HOST}:{port} "
        f"(somente loopback).",
        flush=True,
    )


async def _stop_hook_loopback_listener() -> None:
    """Encerra o listener de loopback, se estiver no ar."""
    global _hook_loopback_server, _hook_loopback_task
    server, task = _hook_loopback_server, _hook_loopback_task
    _hook_loopback_server = None
    _hook_loopback_task = None
    if server is None or task is None:
        return
    server.should_exit = True
    try:
        await asyncio.wait_for(task, timeout=10)
    except asyncio.TimeoutError:
        # wait_for já cancelou a task; só registra para não parecer shutdown limpo.
        print("==> AVISO: canal de hooks não encerrou em 10s — cancelado.", flush=True)
    except Exception as exc:
        print(f"==> AVISO: canal de hooks terminou com erro: {exc!r}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await store.initialize()
    await task_store.initialize()
    await agent_store.initialize()
    await card_store.initialize()
    await settings_store.initialize()
    await push_store.initialize()
    # Generates the VAPID keypair on the very first boot and reuses it from
    # then on (G-1). Never raises — a failure here leaves _vapid_keys as
    # None, which every push path treats as "push unavailable" (R-2).
    global _vapid_keys
    _vapid_keys = await load_or_create_vapid_keys(push_store)
    await _reload_projects_root()
    await _reload_global_agents_cache()
    _pretrust_projects()
    await _start_hook_loopback_listener()
    # print(), não logging: --log-level warning (uso em produção, deploy.sh)
    # suprime até o banner "Uvicorn running on..." do próprio uvicorn, deixando
    # o terminal mudo do início ao fim mesmo quando tudo sobe certo — o que já
    # foi confundido uma vez com travamento. Esta linha ignora esse nível.
    print("==> Backend pronto — aceitando conexões.", flush=True)
    yield
    # Primeiro o canal de hooks: ele serve o MESMO app, então uma requisição em
    # voo depois do close() dos stores bateria em conexão de banco fechada.
    await _stop_hook_loopback_listener()
    await pty_manager.shutdown()
    await store.close()
    await task_store.close()
    await agent_store.close()
    await card_store.close()
    await settings_store.close()
    await push_store.close()


# Two Windows-only workarounds for an abruptly disconnecting client (the
# canonical case: the iPad going to sleep mid-session, killing the TCP
# connection without a FIN). Both are installed before app setup so they are
# already active by the time the first connection can drop.
#
# 1. Drops the benign "data transfer failed" ERROR record that the websockets
#    library logs on OSError(121). See app/logging_filters.py — note it targets
#    `uvicorn.error`, NOT `websockets.server`, because uvicorn injects its own
#    logger into the protocol.
# 2. Works around a CPython bug where an unguarded sock.shutdown() aborts the
#    transport's cleanup `finally`, leaking the socket and — worse — never
#    calling `server._detach()`. See app/asyncio_patches.py.
install_benign_transfer_error_filter()
install_proactor_connection_lost_patch()


class RejectBackslashPathMiddleware:
    """Rejects any HTTP request whose path contains a backslash with 400.

    Guards against PYSEC-2026-2281 in Starlette 0.38.6. That version is pinned
    transitively (FastAPI 0.115.0 requires `starlette<0.39.0`), so the flaw
    cannot be closed by a dependency bump alone. The flaw:
    `StaticFiles.lookup_path()` builds the target with
    `os.path.join(directory, path)`, and on Windows a path component shaped
    like `\\\\attacker-host\\share\\file` makes that join collapse into a UNC
    path. The `os.path.realpath()` immediately after it opens a real outbound
    SMB connection to that host, and Windows hands the local account's NTLMv2
    hash to whoever answers — an OS credential leak, not just an app one. It
    also stalls the calling thread for the full TCP timeout (~21s measured) in
    the same anyio worker pool that serves this app's synchronous handlers,
    so it doubles as a cheap DoS against real API routes.

    Deliberately global instead of scoped to the StaticFiles mounts: one guard
    covers all four current mounts plus any added later, and a backslash is
    never legitimate in this app's URLs. Registered as the outermost
    middleware (Starlette's `add_middleware` prepends), so the request is
    refused before routing — no handler, no mount, no filesystem lookup ever
    sees it.

    Inspects `scope["path"]`, which the ASGI server delivers percent-decoded,
    so `%5C` is rejected along with a literal backslash. `raw_path` would miss
    the encoded form.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and "\\" in scope.get("path", ""):
            response = JSONResponse(
                status_code=400,
                content={"detail": "Backslash is not allowed in the request path."},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


app = FastAPI(title="TaskNexus API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added after CORS on purpose: `add_middleware` inserts at the front of the
# stack, so the last one registered is the outermost and runs first.
app.add_middleware(RejectBackslashPathMiddleware)

# CRÍTICO: StaticFiles derruba o processo no boot se o diretório não existir
# — precisa existir ANTES do app.mount() ser executado (import time, não
# lifespan, porque o mount em si roda no nível de módulo).
os.makedirs(BOARD_UPLOADS_ROOT, exist_ok=True)
app.mount("/board_uploads", StaticFiles(directory=BOARD_UPLOADS_ROOT), name="board_uploads")


@asynccontextmanager
async def _session_lock(session_key: str):
    """Serializa o bloco por `session_key` (ADR-C5) e ainda assim não deixa
    `_session_locks` crescer para sempre.

    Substituiu um `_get_lock(session_key) -> asyncio.Lock` que só criava a
    entrada e nunca a removia. Devolver o objeto Lock para o caller era o que
    tornava a limpeza impossível de fazer com segurança: entre "pegar o objeto
    do dict" e "adquirir o objeto" o caller fica com uma referência que o dict
    não conhece mais se alguém tiver removido a entrada no meio. Aqui o
    ciclo de vida inteiro (criar → adquirir → liberar → remover) mora numa
    função só, e a entrada é removida SÓ quando o último usuário sai.

    Por que refcount e não `lock.locked()` antes de um `pop`:
    - Um caller que já pegou a instância mas ainda NÃO adquiriu não aparece em
      `locked()` — ele nem é visível para quem olha o lock de fora.
    - Pior: `Lock.release()` zera `_locked` ANTES de o próximo da fila acordar
      e reassumir. Existe portanto uma janela real em que há um waiter
      enfileirado e `locked()` responde False. Remover a entrada nessa janela
      faz o waiter esperar num Lock órfão enquanto o caller seguinte cria um
      Lock novo e entra em paralelo — exatamente a corrida que o ADR-C5
      fechou, reaberta pela "limpeza".
    O contador acima conta INTENÇÃO de uso (holders + waiters), não estado
    interno do Lock, e por isso cobre as duas janelas.

    Atomicidade: do primeiro `get` até o incremento não há nenhum `await`, e
    do release até o decremento também não — os dois trechos são indivisíveis
    para o event loop, então nenhum outro caller consegue observar (nem criar)
    um estado intermediário. Consequência: enquanto existir qualquer caller
    dentro deste bloco, `_session_locks[session_key]` está presente e é a
    MESMA instância que todos eles estão usando.

    Deliberadamente não é chamado de `terminate_session`/`reset_session`/
    cleanup do grace period: a remoção é dirigida por uso, não por evento de
    ciclo de vida da sessão. Um `pop` a partir de fora reabriria a janela
    descrita acima — se um dia parecer necessário, não é.
    """
    lock = _session_locks.get(session_key)
    if lock is None:
        lock = _session_locks[session_key] = asyncio.Lock()
    _session_lock_users[session_key] = _session_lock_users.get(session_key, 0) + 1
    try:
        async with lock:
            yield
    finally:
        # Roda também em cancelamento e em exceção (inclusive falha de
        # aquisição), senão o refcount ficaria alto para sempre e a entrada
        # nunca mais seria removida — vazamento silencioso de volta.
        remaining = _session_lock_users[session_key] - 1
        if remaining:
            _session_lock_users[session_key] = remaining
        else:
            del _session_lock_users[session_key]
            # Identidade, não só presença: garante que estamos removendo a
            # instância que este bloco contabilizou. Com o refcount em zero
            # não há como ser outra, mas a checagem deixa a invariante
            # explícita para quem mexer aqui depois.
            if _session_locks.get(session_key) is lock:
                del _session_locks[session_key]


async def _reload_global_agents_cache() -> None:
    global _global_agents_cache
    _global_agents_cache = await agent_store.list_all()


def _resolve_agent(project_id: str, agent_id: str | None):
    projects = scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)
    proj = next((p for p in projects if p.id == project_id), None)
    if not proj:
        return None, None, PROJECTS_ROOT
    cwd = proj.path
    agent = None
    if agent_id:
        agent = next((a for a in proj.agentes if a.id == agent_id), None)
    if not agent and proj.agentes:
        agent = next((a for a in proj.agentes if a.default), proj.agentes[0])
    return proj, agent, cwd


# Fase 4 (ADR-02 revisado): hook Stop dispara sempre que o Claude Code termina
# uma resposta e volta a aguardar o usuário — cobre pedido de permissão,
# pergunta em aberto e conclusão normal (indistinguíveis pra nós, já que o
# hook Stop não diferencia o motivo), substituindo a heurística de transição
# running->idle que nunca disparava na
# prática (a própria TUI manda ESC[?6n a cada ~200ms, resetando o timer de
# atividade pra sempre). `-d @-` repassa o stdin do hook (JSON com session_id)
# direto como corpo da requisição.
def _build_stop_hook_settings() -> str:
    """Monta o --settings com o hook Stop (era a constante _STOP_HOOK_SETTINGS).

    Virou função porque a URL deixou de ser fixa: ela sai de
    _hook_callback_base_url(), que decide entre o listener de loopback e o
    fallback em runtime. Montar a cada spawn, em vez de congelar no import,
    mantém o comando alinhado com a configuração corrente do canal.

    -k: aceita cert autoassinado/CN mismatch quando _hook_callback_base_url()
    devolve https (só acontece via override HOOK_CALLBACK_BASE_URL — o
    listener de loopback em si é sempre http://127.0.0.1). Sem custo quando a
    URL é http: curl ignora -k nesse caso.
    """
    stop_url = f"{_hook_callback_base_url()}/api/hooks/stop"
    return json.dumps({
        "hooks": {
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": (
                                f"curl -sk -m 3 -X POST {stop_url} "
                                "-H 'Content-Type: application/json' -d @- >/dev/null 2>&1"
                            ),
                        }
                    ]
                }
            ]
        }
    })


# Como reconhecer, por tipo de agente, que a retomada de uma sessão FALHOU —
# consumido pelo probe de resume-failure no pty_endpoint (ver lá).
#
# - `markers`: byte-strings que, se aparecerem na saída do PTY dentro da janela
#   do probe, significam "esse id não existe mais". Tupla e não string única de
#   propósito: um CLI pode mudar a redação entre versões e conviver com as duas,
#   e uma tupla vazia é um estado representável (= "não sei qual é a string").
# - `exit_is_failure`: se o processo MORRER dentro da janela do probe conta como
#   falha de retomada, mesmo sem nenhum marker ter casado.
#
# `exit_is_failure` é o que desacopla esta feature de uma incógnita empírica: a
# saída real de `cursor-agent --resume <id-inexistente>` não é conhecida, então
# `markers` está vazio — mas o Cursor que falha em retomar MORRE, e isso o probe
# vê. Sem o flag, morrer só faria `break` e o usuário ficaria com um terminal
# morto e mudo. Quando a string aparecer, é só acrescentá-la aqui: ela torna a
# detecção mais rápida e específica, não é pré-requisito.
#
# Falso positivo aceito para o cursor: um processo que morre por outro motivo
# (chave inválida, endpoint fora) dentro da janela também vira `resume_failed`.
# Mas os bytes dele já foram encaminhados ao cliente antes disso, então o usuário
# VÊ a mensagem real de erro e recebe um overlay oferecendo "Iniciar nova
# conversa" — que é a ação certa na esmagadora maioria dos casos. Errar assim é
# estritamente melhor que um terminal morto sem explicação.
#
# O claude fica com `exit_is_failure=False`: é exatamente o comportamento que ele
# já tinha, e mudar semântica testada do claude numa rodada que não é sobre ele
# seria trocar um risco conhecido por um desconhecido.
_RESUME_FAILURE_SIGNATURES: dict[str, dict] = {
    "claude": {
        "markers": (b"No conversation found with session ID",),
        "exit_is_failure": False,
    },
    "cursor": {
        "markers": (),
        "exit_is_failure": True,
    },
    # antigravity/gemini/agy have deliberately NO entry here (same spirit as
    # "terminal", which also has none): resume means `--continue` ("most
    # recent conversation"), verified experimentally (2026-08-26) to never
    # fail — with zero prior conversations it just starts a fresh one
    # silently, with no error text to key a probe on. A `signature` dict
    # with empty markers would still be truthy and make the caller run the
    # up-to-5s probe loop for nothing, blocking the user's input the whole
    # time (ws_to_pty() only starts after the probe returns) — pure cost,
    # zero detection. Omitting the entry makes `.get()` return None, so
    # `if resume and signature:` below skips the probe entirely and goes
    # straight to full-duplex streaming.
}


class _McpServerSpec(TypedDict):
    """Forma estrutural de cada entrada de _escritorio_mcp_servers.

    Existe para tornar o contrato explícito: _build_codex_config_overrides
    consome `spec['command']` / `spec['args']` / `spec['env']` por índice
    dentro de um bloco que só captura ValueError — um KeyError por chave
    faltando escaparia daí e viraria uma tempestade de reconexão.
    """

    command: str
    args: list[str]
    env: dict[str, str]


def _escritorio_mcp_servers(session_id: str) -> dict[str, _McpServerSpec]:
    """Especificação (command/args/env) dos dois servidores MCP do Escritório.

    Fonte única de verdade para os DOIS formatos de registro que existem hoje:
    o `--mcp-config` inline JSON do `claude` (_build_mcp_config_json) e os
    `-c mcp_servers.*` do `codex` (_build_codex_config_overrides). Extraído
    para que os nomes de env var e os sufixos de URL de callback não possam
    divergir entre os dois CLIs — se divergirem, um dos dois passa a chamar
    endpoints que não existem, e o modo de falha é silencioso (POST
    fire-and-forget).

    Os abspaths são resolvidos a partir de __file__ (diretório deste módulo),
    NÃO do cwd do PTY — o cwd do PTY é o diretório do projeto do usuário, onde
    os scripts não existem.

    session_id é repassado como env var (ESCRITORIO_CLAUDE_SESSION_ID) para o
    processo filho de cada adaptador, que o inclui no POST aos respectivos
    endpoints /api/hooks/... — é assim que o backend resolve de volta a
    session_key do Escritório (via ConversationStore.get_session_key_by_claude_id).

    As URLs de callback vão explícitas em vez de ficarem no default de cada
    adaptador (`http://localhost:8000/...`): esse default só acerta no fluxo
    de dev, e em produção o backend responde noutra porta — mesmo problema que
    matava o hook Stop. Cada servidor recebe apenas as URLs que ele usa.
    """
    module_dir = os.path.dirname(os.path.abspath(__file__))
    base_url = _hook_callback_base_url()
    return {
        "escritorio-tarefas": {
            "command": sys.executable,
            "args": [os.path.join(module_dir, "mcp_task_adapter.py")],
            "env": {
                "ESCRITORIO_CLAUDE_SESSION_ID": session_id,
                "ESCRITORIO_HOOK_URL": f"{base_url}/api/hooks/task",
                # Defense in depth alongside the reconfigure() calls in
                # mcp_task_adapter.main(): forces UTF-8 mode for the whole
                # child interpreter (stdin/stdout/stderr + filesystem),
                # not just the two streams reconfigure() touches.
                "PYTHONUTF8": "1",
            },
        },
        "escritorio-cards": {
            "command": sys.executable,
            "args": [os.path.join(module_dir, "mcp_card_adapter.py")],
            "env": {
                "ESCRITORIO_CLAUDE_SESSION_ID": session_id,
                "ESCRITORIO_HOOK_CREATE_URL": f"{base_url}/api/hooks/cards/create",
                "ESCRITORIO_HOOK_MOVE_URL": f"{base_url}/api/hooks/cards/move",
                "ESCRITORIO_HOOK_UPDATE_URL": f"{base_url}/api/hooks/cards/update",
                "ESCRITORIO_HOOK_DELETE_URL": f"{base_url}/api/hooks/cards/delete",
                "ESCRITORIO_HOOK_GET_URL": f"{base_url}/api/hooks/cards/get",
                "ESCRITORIO_HOOK_LIST_URL": f"{base_url}/api/hooks/cards/list",
                "PYTHONUTF8": "1",
            },
        },
    }


def _build_mcp_config_json(session_id: str) -> str:
    """Gera o --mcp-config inline JSON que registra os adaptadores MCP
    (mcp_task_adapter.py e mcp_card_adapter.py, ver esses arquivos) como
    servidores stdio do `claude` CLI, expondo `criar_tarefa_validacao`
    (escritorio-tarefas) e `criar_card`/`mover_card`/`editar_card`/
    `excluir_card`/`ver_card`/`listar_cards` (escritorio-cards, Tarefa 8 do
    plano 05-TL.md + Fase 3). Os abspaths são resolvidos a partir de
    __file__ (diretório deste módulo), NÃO do cwd do PTY — o cwd do PTY é o
    diretório do projeto do usuário, onde os scripts não existem.

    session_id é repassado como env var (ESCRITORIO_CLAUDE_SESSION_ID) para
    o processo filho de cada adaptador, que o inclui no POST aos respectivos
    endpoints /api/hooks/... — é assim que o backend resolve de volta a
    session_key do Escritório (via ConversationStore.get_session_key_by_claude_id).

    Spike validado manualmente (fora deste código) confirmou que
    --mcp-config inline JSON funciona com o `claude` CLI real: a tool é
    reconhecida e chamada com os argumentos exatos.

    A especificação em si (comando, args e env de cada servidor) mora em
    _escritorio_mcp_servers, compartilhada com o registro equivalente do
    `codex` — aqui fica só a serialização no formato que o `claude` aceita.
    """
    return json.dumps({"mcpServers": _escritorio_mcp_servers(session_id)})


# ---------------------------------------------------------------------------
# codex (OpenAI CLI)
#
# O codex é um "agente de argv, não de arquivo": tudo o que o claude recebe via
# --settings/--mcp-config, ele recebe via `-c chave=valor` no spawn, e cada `-c`
# é MESCLADO com o ~/.codex/config.toml em disco (verificado contra o binário
# real, codex-cli 0.153.2). Nada aqui escreve no CODEX_HOME do usuário, e o
# backend deliberadamente NÃO seta CODEX_HOME: o codex roda com o perfil real do
# usuário (login, plugins, MCPs próprios), e quem quiser um perfil separado põe
# CODEX_HOME no campo `env` do cadastro do agente.
# ---------------------------------------------------------------------------
CODEX_APPROVAL_POLICY = "never"
CODEX_SANDBOX_MODE = "workspace-write"
# Desliga o check de "Update available" no startup do codex: com release nova no
# npm, o codex abre com esse prompt e um Enter do usuário roda
# `npm install -g @openai/codex` no meio da sessão do Escritório.
#
# Emitido como booleano TOML CRU (`check_for_update_on_startup=false`), FORA do
# loop de _toml_literal abaixo: essa chave é tipada como bool pelo codex, e
# passá-la como literal string (`'false'`) faz o carregamento do config INTEIRO
# falhar — `config.load: fail, "config could not be loaded"`, PTY abre e fecha
# (medido contra codex-cli 0.153.2; o bare `false` reflete em
# `codex doctor --json` como `"check for update on startup": "false"`). É o
# único `-c` que não passa pelo encoder, e o valor é uma constante fixa sem
# entrada de usuário — nada a sanear.
CODEX_CHECK_FOR_UPDATE = "false"
# Subcomando de retomada. `--last` = "continue a sessão mais recente sem abrir o
# seletor" — o seletor é uma TUI de escolha que travaria o PTY sem saída pela UI
# do Escritório. Por padrão o codex já filtra as sessões pelo cwd (é o que
# `--all` desliga), então na prática isso retoma a última conversa DAQUELE
# projeto. Duas abas do Escritório no mesmo projeto continuam ambíguas entre si:
# mesma limitação, já aceita, do `--continue` do agy.
CODEX_RESUME_ARGS = ("resume", "--last")

# Caracteres que nunca podem entrar num token `-c chave=valor`.
#
# `'` e `"`: encerrariam/derrubariam a literal string TOML que este encoder
#   produz. ADR-C4: todo valor vai como literal string (aspas SIMPLES),
#   justamente para a barra invertida de um path Windows continuar sendo barra
#   invertida — numa basic string ("...") o TOML trataria `\U`, `\t` etc. como
#   escapes, e o codex degrada em SILÊNCIO para "string crua" quando o parse
#   falha (um array vira string e explode depois como erro de tipo).
# `% & | < >`: o pywinpty resolve `codex` para `codex.CMD` e o executa ATRAVÉS
#   do `cmd.exe` (winpty/ptyprocess.py: which() + subprocess.list2cmdline), ou
#   seja, o cmd.exe reprocessa a linha de comando uma segunda vez. Medido contra
#   o binário real num ConPTY de verdade:
#     - `%NOME%` é expandido mesmo dentro de token citado (um path contendo
#       `%PATH%` voltou com o PATH real no lugar);
#     - `& | < >` só escapam ilesos enquanto o token por acaso contém um espaço,
#       que é a ÚNICA razão pela qual o list2cmdline o coloca entre aspas — sem
#       espaço, um `&` parte a linha de comando e o codex morre com
#       "Invalid override (missing '=')".
#   Fazer a regra depender de "esse token tem espaço?" seria uma armadilha, então
#   os cinco são rejeitados sempre.
# `^ ! ( )` NÃO estão aqui de propósito: os quatro foram medidos e atravessam
#   intactos. O `!` só é especial sob delayed expansion do CMD, que o ConPTY não
#   liga.
# CR/LF: partiriam o token; impossível na prática, barato de excluir.
_TOML_LITERAL_FORBIDDEN = "'\"%&|<>\r\n"


def _toml_literal(value: str) -> str:
    """Encoda `value` como uma literal string TOML para um `-c chave=valor`.

    Literal string = aspas simples e NENHUM escape (é o ponto: a barra invertida
    de um path Windows tem que chegar ao codex como barra invertida). Como não
    há escape possível, qualquer caractere de _TOML_LITERAL_FORBIDDEN é
    irrepresentável e vira ValueError — cabe a quem chama decidir o que degradar
    (ver _build_codex_config_overrides, que nunca deixa esse erro escapar).

    Vale inclusive para valores que "parecem" outro tipo: `1` nu viraria o
    integer TOML 1, e o codex tipa `env` como map<string,string>, então
    PYTHONUTF8 precisa sair daqui como `'1'`, não como `1`.
    """
    for char in _TOML_LITERAL_FORBIDDEN:
        if char in value:
            raise ValueError(
                f"value cannot be encoded as a TOML literal string "
                f"(contains {char!r}): {value!r}"
            )
    return f"'{value}'"


def _toml_literal_array(values: list[str]) -> str:
    """Encoda uma lista de strings como array TOML de literal strings.

    Propaga o ValueError de _toml_literal: um array pela metade seria pior que
    array nenhum (o codex receberia um comando truncado e o executaria).
    """
    return "[" + ",".join(_toml_literal(value) for value in values) + "]"


def _build_codex_notify_argv(session_id: str) -> list[str]:
    """argv do `notify` do codex — o equivalente do hook Stop do claude.

    O codex executa esse argv acrescentando UM argumento final (o JSON do
    evento), e não sabe nada sobre a session_key do Escritório; por isso o
    session_id vai fixo em argv[1] e a URL em argv[2], e a correlação é feita
    por posição, não pelo payload. Ver app/codex_notify_adapter.py.

    O abspath do adaptador sai de __file__, NUNCA do cwd do PTY — o cwd é a
    pasta do projeto do usuário, onde o script não existe.
    """
    module_dir = os.path.dirname(os.path.abspath(__file__))
    return [
        sys.executable,
        os.path.join(module_dir, "codex_notify_adapter.py"),
        session_id,
        f"{_hook_callback_base_url()}/api/hooks/stop",
    ]


def _build_codex_config_overrides(session_id: str, cwd: str | None) -> list[str]:
    """Monta a lista PLANA de `-c chave=valor` do spawn do codex.

    Devolve ["-c", "k=v", "-c", "k=v", ...] — plana porque é concatenada direto
    no argv.

    NUNCA levanta exceção. Isso é invariante duro, não zelo: dois dos três
    call sites de _ensure_pty só capturam OSError (POST .../continue e
    POST .../paste), então um ValueError vazando daqui viraria uma tempestade de
    reconexão em vez de um erro visível. A degradação é por chave: se a chave de
    UM servidor MCP não encoda, o servidor INTEIRO é omitido (meio servidor é
    pior que nenhum — o codex subiria um stdio server sem as env vars de
    callback e toda chamada de tool falharia em silêncio).

    `cwd` não é consumido pelo corpo desta função: uma tentativa anterior de
    usá-lo para pré-aceitar o trust do projeto via `-c
    projects.'<cwd>'.trust_level=...` se mostrou NO-OP contra o binário real
    (o valor parseia e desserializa, mas o gate de trust da TUI não consulta
    esse override — só uma entrada on-disk em `~/.codex/config.toml` suprime o
    prompt, e o TaskNexus deliberadamente não escreve nesse arquivo, ver ADR de
    "agente de argv"). O parâmetro foi mantido na assinatura (call sites e
    testes dependem dela) mas hoje não faz nada; o usuário responde o prompt de
    trust da TUI uma vez por projeto e o próprio codex persiste depois. O gate
    separado "workspace confiável OU repositório git" que o codex aplica antes
    de liberar a sandbox workspace-write não foi verificado neste probe — não
    está confirmado se ele também depende do trust_level ou se é satisfeito de
    outra forma quando o projeto é um repo git.

    Nota sobre a URL de callback: _hook_callback_base_url() cai no fallback
    (porta do app principal) quando o listener de loopback não está no ar. É
    exatamente o que o claude já faz hoje, aceito e fora do escopo desta feature.
    """
    overrides: list[str] = []

    for key, value in (
        ("approval_policy", CODEX_APPROVAL_POLICY),
        ("sandbox_mode", CODEX_SANDBOX_MODE),
    ):
        try:
            overrides += ["-c", f"{key}={_toml_literal(value)}"]
        except ValueError as exc:
            print(f"==> AVISO: codex: override '{key}' omitido: {exc}", flush=True)

    # Booleano TOML cru, sem _toml_literal — ver CODEX_CHECK_FOR_UPDATE. Valor
    # constante, sem encoder, então não há degradação a fazer.
    overrides += ["-c", f"check_for_update_on_startup={CODEX_CHECK_FOR_UPDATE}"]

    try:
        overrides += [
            "-c",
            f"notify={_toml_literal_array(_build_codex_notify_argv(session_id))}",
        ]
    except ValueError as exc:
        print(f"==> AVISO: codex: notify omitido: {exc}", flush=True)

    for name, spec in _escritorio_mcp_servers(session_id).items():
        try:
            # Só os VALORES passam por _toml_literal. As porções de CHAVE
            # (`name`, `env_name`) são constantes literais deste módulo, não
            # entrada de usuário — não há o que sanear, e nenhuma delas contém
            # um caractere proibido.
            server = [
                "-c", f"mcp_servers.{name}.command={_toml_literal(spec['command'])}",
                "-c", f"mcp_servers.{name}.args={_toml_literal_array(spec['args'])}",
            ]
            for env_name, env_value in spec["env"].items():
                server += [
                    "-c",
                    f"mcp_servers.{name}.env.{env_name}={_toml_literal(env_value)}",
                ]
        except ValueError as exc:
            print(f"==> AVISO: codex: servidor MCP '{name}' omitido: {exc}", flush=True)
            continue
        overrides += server

    return overrides


def _build_codex_cmd(agent, session_id: str, resume: bool, cwd: str | None) -> list[str]:
    """Monta o argv do codex para o PTY. Nunca levanta exceção (ver overrides).

    Os `-c` vêm DEPOIS do subcomando `resume` de propósito: o parser do codex
    aceita `-c` tanto global quanto por subcomando, e pô-los depois evita
    qualquer dúvida sobre a que comando eles pertencem.

    `system_prompt` é IGNORADO, mesmo tratamento dos ramos "cursor"/"terminal":
    o codex não tem um equivalente de --append-system-prompt, e o PROMPT
    posicional consumiria o primeiro turno da conversa (o agente responderia ao
    system prompt em vez de esperar o usuário). O caminho do codex para
    instruções persistentes é o AGENTS.md do projeto, fora do escopo daqui.
    """
    cmd = list(agent.cmd) if agent else ["codex"]
    if resume:
        cmd += list(CODEX_RESUME_ARGS)
    return cmd + _build_codex_config_overrides(session_id, cwd)


def _build_pty_cmd(
    session_id: str, resume: bool, system_prompt: str | None,
    base_cmd: list[str] | None = None,
) -> list[str]:
    """Builds the claude CLI invocation for interactive PTY mode (PTY-03).

    No "-p", no "--output-format" — interactive REPL is required.
    --append-system-prompt is only ever passed for fresh sessions; on
    --resume, Claude already has the system prompt from the original spawn.

    --mcp-config is added unconditionally (fresh AND resume) — the
    criar_tarefa_validacao tool must be available regardless of how the
    session started.

    base_cmd overrides the literal "claude" argv[0] with a registered global
    agent's cmd (Global Agent Registry, e.g. claude-work) — defaults to
    ["claude"] when the resolved agent has no custom cmd or wasn't resolved
    at all. Everything after it is still appended unconditionally, same as
    before this parameter existed.
    """
    cmd = list(base_cmd or ["claude"]) + [
        "--settings", _build_stop_hook_settings(),
        "--mcp-config", _build_mcp_config_json(session_id),
    ]
    if resume:
        cmd += ["--resume", session_id]
    else:
        cmd += ["--session-id", session_id]
        if system_prompt:
            cmd += ["--append-system-prompt", system_prompt]
    return cmd


def _build_agent_cmd(
    agent, session_id: str, resume: bool, system_prompt: str | None,
    cwd: str | None = None,
) -> list[str]:
    """Dispatches to the right CLI invocation based on the resolved agent's `ia`.

    Claude keeps the exact --session-id/--resume/--append-system-prompt contract
    (delegates to _build_pty_cmd, which now also honors the agent's registered
    cmd as the spawn base — e.g. a "claude-work" global agent launches that
    binary instead of the hardcoded "claude", while still getting the
    Stop-hook/mcp-config flags _build_pty_cmd always appends).

    ia="codex" builds the OpenAI `codex` CLI invocation via _build_codex_cmd —
    parity with claude (PTY + resume + end-of-turn notify + the two Escritório
    MCP servers), delivered entirely through `-c key=value` spawn overrides
    instead of config files. `cwd` (the resolved project directory) is
    threaded through to this branch but currently unused by it: an earlier
    attempt to pre-trust the workspace via a `-c projects.'<cwd>'.trust_level`
    override proved to be a no-op against the real binary (see
    _build_codex_config_overrides for the measurement) and was removed; the
    parameter stays in the signature for call-site/test stability and possible
    future use.

    `cwd` defaults to None so every pre-existing call site (and contract test,
    which passes `system_prompt=` by keyword) is unaffected — only claude/codex
    care about it and claude ignores it.

    ia="terminal" is a raw terminal — no CLI contract to honor at all, so
    agent.cmd is returned completely unmodified (no --dangerously-skip-
    permissions, no --prompt-interactive, no session id ever appended):
    shells like powershell/cmd/bash don't understand those flags.

    ia="cursor" always resumes an existing chat — ver o ramo abaixo para o
    porquê de `--resume` vir por último e de `system_prompt` ser ignorado.

    Other agent types (Gemini/Antigravity's `agy`) do NOT have an explicit
    session-id contract: verified experimentally (2026-08-26) against the
    real `agy` binary that `--session-id` and `--resume` are simply not
    recognized flags (Go flag parser: "flags provided but not defined"),
    which made every antigravity/gemini spawn die on startup — that was the
    actual bug. `--conversation <id>` is agy's real resume flag, but it does
    NOT accept externally-assigned ids either: passing a made-up id always
    prints `warning: conversation "<id>" not found` and starts a brand new
    conversation, proving agy owns its own id space and there is no way for
    us to pin a conversation to an id we generate.

    So this branch falls back to agy's own "most recent" semantics:
    `resume=True` passes `--continue` (confirmed to work even with zero
    prior conversations — it just starts fresh, no error). This reintroduces
    the multi-chat ambiguity a prior version of this docstring warned about
    (a cold reconnect could resume a DIFFERENT tab's conversation in the
    same project) — that is a known, accepted limitation until agy exposes
    a real explicit-id resume contract, not an oversight.
    `--dangerously-skip-permissions` is restored here (it was dropped when
    this branch was split out from the generic fallback below, silently
    losing auto-approve for these agents). `system_prompt`, only on a fresh
    session, is passed via `--prompt-interactive` (agy's flag — NOT
    --append-system-prompt, that is claude-specific).
    """
    if agent is None or agent.ia == "claude":
        return _build_pty_cmd(session_id, resume, system_prompt, base_cmd=agent.cmd if agent else None)
    if agent.ia == "codex":
        return _build_codex_cmd(agent, session_id, resume, cwd)
    if agent.ia == "terminal":
        return list(agent.cmd)
    if agent.ia == "cursor":
        # `--resume <chatId>` SEMPRE, inclusive numa sessão nova: para o Cursor
        # o id não é inventado por nós, é emitido pelo `cursor-agent create-chat`
        # (session_provisioner.py) antes deste ponto — então quando chegamos
        # aqui o chat já existe dos dois lados, e retomá-lo é o único jeito de a
        # conversa ter memória. Por isso o parâmetro `resume` é ignorado neste
        # ramo: ele significa "o id já existia ANTES desta chamada" (e é o que
        # decide se o probe de resume-failure roda), não "o argv usa --resume".
        #
        # O `--resume <chatId>` vai por ÚLTIMO no argv de propósito: no Cursor o
        # parâmetro é OPCIONAL (`--resume [chatId]`), então uma flag colada
        # depois dele poderia ser confundida com o valor, deixando o `--resume`
        # efetivamente nu — e `--resume` nu abre o SELETOR INTERATIVO, que
        # travaria o PTY numa TUI sem saída pela UI.
        #
        # `--trust` é o equivalente do "confio neste workspace", coerente com o
        # que _pretrust_projects faz para o claude. `--yolo`/`--force` ficam
        # deliberadamente FORA: quem quiser esse comportamento acrescenta a flag
        # no `cmd` do cadastro do agente, sem mudança de código.
        #
        # `system_prompt` é IGNORADO: o Cursor não tem --append-system-prompt, e
        # um `--prompt` posicional consumiria o turno da conversa (o agente
        # responderia ao system prompt em vez de esperar o usuário). Mesmo
        # tratamento do ramo "terminal". O caminho do Cursor para instruções
        # persistentes é `.cursor/rules`, fora do escopo daqui.
        #
        # Sem --mcp-config (o Cursor não aceita config inline) e sem
        # --settings/hook Stop (não existe): uma sessão Cursor não cria cards no
        # Board, não cria tarefas de validação e não avisa quando termina de
        # responder. Mesma paridade do `agy`.
        return list(agent.cmd) + ["--trust", "--resume", session_id]
    if agent.ia in ("antigravity", "gemini", "agy"):
        cmd = list(agent.cmd) + ["--dangerously-skip-permissions"]
        if resume:
            cmd += ["--continue"]
        elif system_prompt:
            cmd += ["--prompt-interactive", system_prompt]
        return cmd
    cmd = list(agent.cmd) + ["--dangerously-skip-permissions"]
    if system_prompt:
        cmd += ["--prompt-interactive", system_prompt]
    return cmd


async def _ensure_pty(session_key: str, project_id: str, agent_id: str | None,
                       cols: int = 80, rows: int = 24):
    """Garante que existe um PTY vivo para session_key: reaproveita se já
    ativo, senão resolve o agent, monta o cmd, registra a sessão no store E
    SÓ ENTÃO spawna o processo.

    A ordem store.set-antes-de-spawn é proposital (reordenação vs. o código
    original, que spawnava primeiro): spawnar antes deixava uma janela de
    corrida em que a tool MCP (criar_tarefa_validacao, que roda dentro do
    processo recém-spawnado) podia chamar POST /api/hooks/task antes do
    claude_session_id estar resolvível de volta para session_key via
    ConversationStore.get_session_key_by_claude_id — a tarefa seria
    descartada silenciosamente (POST /api/hooks/task é fire-and-forget por
    design). Gravar o mapeamento antes do processo existir elimina essa
    corrida.

    Extraído de pty_endpoint para ser compartilhado com POST .../continue.
    Deliberadamente NÃO inclui: envio de snapshot, o probe de
    resume-failure, nem o frame de controle resume_failed — tudo isso é
    acoplado ao WebSocket e continua vivendo em pty_endpoint, que consome o
    `resume`/`agent` retornados aqui para decidir se roda o probe.

    O corpo inteiro roda sob `_session_lock(session_key)` — serialização por chave
    de sessão. Três caminhos chamam esta função para a mesma chave (o
    pty_endpoint, POST .../continue e POST .../paste), e o trecho entre o
    `store.get` e o `store.set` deixou de ser instantâneo: com um agente cujo id
    de sessão é PROVISIONADO por subprocess (`ia="cursor"`, ver
    session_provisioner.py), essa janela passa a conter vários segundos de I/O.
    Sem o lock, dois callers concorrentes rodariam `create-chat` duas vezes e o
    segundo `pty_manager.spawn` mataria o PTY do primeiro (spawn() chama
    terminate() antes de criar), deixando um chat órfão para trás. A checagem
    `proc and proc.active` fica DENTRO do lock (double-checked locking), senão o
    segundo caller ainda spawnaria em cima do primeiro.

    Escopo simples de propósito (lock em volta de tudo, um único check dentro),
    e não fast-path fora do lock + recheck dentro: a frequência aqui é de uma
    chamada por abertura de aba, o overhead do lock é irrelevante nessa escala, e
    o caminho único é muito mais fácil de revisar. Sem risco de deadlock —
    nenhum call site aninha `_ensure_pty`. Se a task que segura o lock for
    cancelada no meio do provisioning, o cancelamento propaga, o `async with`
    desenrola e o lock é liberado (e a entrada do dict é devolvida — ver
    `_session_lock`).

    Retorna (proc, spawned, resume, agent):
    - spawned=False -> processo reaproveitado (proc.active já era True);
      caller decide o que fazer com isso (ex: replay de snapshot).
    - spawned=True -> processo novo; resume indica se foi um --resume
      (session_uuid pré-existente) ou uma sessão nova.

    Levanta:
    - `LookupError` — agent_id explícito não resolvível (ver o guard abaixo).
    - `OSError` — falha de spawn do PTY (ex.: cmd[0] não é executável real) ou
      falha de provisioning do id de sessão
      (`session_provisioner.SessionProvisioningError`, que É `OSError` justamente
      para caber no catch anti-reconnect-storm que já existe no pty_endpoint).
    Todo caller precisa tratar os dois — inclusive os endpoints HTTP, que
    prometem nunca devolver 4xx/5xx.
    """
    async with _session_lock(session_key):
        return await _ensure_pty_locked(session_key, project_id, agent_id, cols, rows)


async def _ensure_pty_locked(session_key: str, project_id: str, agent_id: str | None,
                             cols: int, rows: int):
    """Corpo de `_ensure_pty`, já sob o lock da session_key. Separado só para
    manter a indentação (e o diff) legíveis — nunca chamar direto."""
    proc = pty_manager.get(session_key)
    if proc and proc.active:
        return proc, False, False, None

    proj, agent, cwd = _resolve_agent(project_id, agent_id)
    if agent_id and (agent is None or agent.id != agent_id):
        # Um agent_id explícito foi pedido mas _resolve_agent não achou (projeto
        # não "elegível" — sem .claude/.gemini/.codex, então proj.agentes vem vazio —
        # ou o id não existe mais no Global Agent Registry). SEM esse guard,
        # _build_agent_cmd(None, ...) cai silenciosamente no `claude` puro, sem
        # nenhum env/cmd customizado do agente pedido — ex.: um agente com
        # CLAUDE_CONFIG_DIR próprio (perfil separado) spawna com o perfil
        # padrão errado, sem qualquer aviso. Levantar aqui em vez de deixar
        # passar: caller decide como reportar (ver pty_endpoint).
        raise LookupError(
            f"Agent '{agent_id}' não disponível para o projeto '{project_id}' "
            "(projeto não elegível ou agente removido)."
        )
    claude_sid = await store.get(session_key)
    # Antes desta linha o id era SEMPRE inventado localmente (`uuid4`). Continua
    # sendo, para todo agente que não seja o Cursor — mas o Cursor não aceita um
    # id nosso: ele EMITE o dele via `cursor-agent create-chat`, então este é o
    # primeiro ponto do backend com I/O assíncrono antes do spawn. Delegado ao
    # session_provisioner para não misturar isso com as invariantes daqui.
    #
    # `resume` mantém o significado histórico — "o id já existia ANTES desta
    # chamada" —, que NÃO é o mesmo que "o argv usa --resume": para o Cursor o
    # argv usa `--resume` sempre, inclusive em sessão nova, mas o probe de
    # resume-failure só deve rodar quando o id era pré-existente (um chat que
    # acabou de nascer não pode "não ser encontrado").
    session_uuid = await provision_session_id(agent, cwd, claude_sid)
    resume = bool(claude_sid)
    cmd = _build_agent_cmd(
        agent,
        session_uuid,
        resume=resume,
        system_prompt=agent.system_prompt if agent else None,
        cwd=cwd,
    )
    await store.set(session_key, session_uuid)
    proc = pty_manager.spawn(session_key, cmd, cwd=cwd, cols=cols, rows=rows,
                              extra_env=agent.env if agent else None)
    return proc, True, resume, agent


@app.get("/api/status")
async def status():
    return {"status": "ok"}


@app.get("/api/settings/appearance", response_model=AppearanceSettings)
async def get_appearance_settings():
    return AppearanceSettings(**await settings_store.get())


@app.put("/api/settings/appearance", response_model=AppearanceSettings)
async def update_appearance_settings(body: AppearanceUpdateRequest):
    updated = await settings_store.update(
        layout_version=body.layout_version, theme_mode=body.theme_mode
    )
    return AppearanceSettings(**updated)


async def _notification_settings_response() -> NotificationSettings:
    """Builds the /api/settings/notifications response: the 3 persisted
    columns + the 2 fields derived from the server's clock (UTC offset and
    the quiet-hours decision already resolved by the pure function). The
    derived fields are recomputed on every response — persisting the offset
    would make the window drift by one hour during daylight saving time."""
    settings = await settings_store.get_notifications()
    offset_minutes = current_utc_offset_minutes()
    return NotificationSettings(
        **settings,
        server_utc_offset_minutes=offset_minutes,
        quiet_hours_active=is_within_quiet_hours(
            enabled=settings["quiet_hours_enabled"],
            start=settings["quiet_hours_start"],
            end=settings["quiet_hours_end"],
            now_epoch_seconds=time.time(),
            utc_offset_minutes=offset_minutes,
        ),
    )


@app.get("/api/settings/notifications", response_model=NotificationSettings)
async def get_notification_settings():
    return await _notification_settings_response()


@app.put("/api/settings/notifications", response_model=NotificationSettings)
async def update_notification_settings(body: NotificationSettingsUpdateRequest):
    await settings_store.update_notifications(
        quiet_hours_enabled=body.quiet_hours_enabled,
        quiet_hours_start=body.quiet_hours_start,
        quiet_hours_end=body.quiet_hours_end,
    )
    return await _notification_settings_response()


# ─── Web Push (Phase 3) ────────────────────────────────────────────────────
# Registered here, alongside the other /api routes, so they sit far ahead of
# the SPA catch-all at the bottom of this file — a push route shadowed by the
# catch-all would answer with index.html and 200 OK, and the browser would
# fail to subscribe with no visible error (same regression class already
# guarded for /sw.js in test_pwa_static_routes.py).
#
# No authentication: these routes inherit the same posture as every other
# route in this app (a personal tailnet install). Adding auth to this one
# endpoint alone would be inconsistent, and is out of scope for this feature.


@app.get("/api/push/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key():
    """applicationServerKey for the browser's pushManager.subscribe().

    Answers 200 with `available: false` instead of an error when the key
    couldn't be provisioned: the UI needs to tell the difference between
    "this server can't do push" and "the request failed", and only a
    successful response carries that distinction cleanly."""
    if _vapid_keys is None:
        return VapidPublicKeyResponse(public_key=None, available=False)
    return VapidPublicKeyResponse(public_key=_vapid_keys.public_key, available=True)


@app.post("/api/push/subscriptions", status_code=201)
async def register_push_subscription(body: PushSubscriptionRequest):
    """Registers this device for push. Idempotent by endpoint (the browser
    hands back the same endpoint for the same device/origin), so two tabs —
    or a re-subscribe after a reload — collapse into a single row instead of
    doubling the notification.

    429 when the device cap is reached: the request is well-formed (so not a
    422) and re-registering an already known device still succeeds, so what
    the caller hit is a rate/volume limit, not a bad payload."""
    try:
        await push_store.upsert(
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
            user_agent=body.user_agent,
        )
    except TooManySubscriptionsError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    return {"status": "subscribed", "endpoint": body.endpoint}


@app.delete("/api/push/subscriptions")
async def delete_push_subscription(body: PushSubscriptionDeleteRequest):
    """Unregisters a device. Tolerates an unknown endpoint (no 404): the
    browser may have already dropped the subscription on its side, and the
    user's intent — "stop pushing to this device" — is satisfied either
    way."""
    await push_store.delete(body.endpoint)
    return {"status": "unsubscribed", "endpoint": body.endpoint}


@app.get("/api/settings/projects-root", response_model=ProjectsRootSettings)
async def get_projects_root_settings():
    settings = await settings_store.get()
    return ProjectsRootSettings(
        projects_root_path=settings.get("projects_root_path"),
        resolved_path=_resolve_projects_root_value(settings),
    )


@app.put("/api/settings/projects-root", response_model=ProjectsRootSettings)
async def update_projects_root_settings(body: ProjectsRootUpdateRequest):
    if not os.path.isdir(body.projects_root_path):
        raise HTTPException(status_code=400, detail=f"Pasta não encontrada: {body.projects_root_path}")
    # Normaliza antes de persistir: tkinter.filedialog.askdirectory() devolve
    # paths com barra normal no Windows (ex: "D:/projetos"), que colidem com
    # o separador nativo usado pelo resto do código (scan_projects via
    # os.walk, e a chave de path que _pretrust_projects grava em
    # ~/.claude.json) — sem isso, o pretrust silenciosamente para de bater
    # com o cwd real que o `claude` CLI relata, e o diálogo de confiança do
    # workspace reaparece.
    normalized = os.path.normpath(os.path.abspath(body.projects_root_path))
    await settings_store.update(projects_root_path=normalized)
    await _reload_projects_root()
    # _pretrust_projects() só roda no lifespan de startup — mas o frontend
    # só recarrega a PÁGINA (window.location.reload()), não reinicia o
    # processo backend, então sem chamar de novo aqui todo projeto na pasta
    # recém-escolhida nunca ganha hasTrustDialogAccepted, e o prompt de
    # confiança aparece pra cada um dentro do terminal. to_thread: é uma
    # função síncrona que faz os.walk recursivo (via scan_projects) + I/O de
    # arquivo — rodar direto aqui travaria o event loop pela duração do
    # walk da pasta recém-escolhida (mesmo cuidado já tomado com
    # _pick_projects_folder, que também roda em thread).
    await asyncio.to_thread(_pretrust_projects)
    settings = await settings_store.get()
    return ProjectsRootSettings(
        projects_root_path=settings.get("projects_root_path"),
        resolved_path=_resolve_projects_root_value(settings),
    )


@app.post("/api/settings/projects-root/browse")
async def browse_projects_root_folder():
    path = await asyncio.to_thread(_pick_projects_folder)
    return {"path": path}


@app.get("/api/projects", response_model=list[Project])
def projects():
    return scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)


def _resolve_project_or_404(project_id: str) -> Project:
    """Same project_id -> Project resolution used by _resolve_agent, pulled
    out for the attachments routes below (which don't need an agent, just
    the project's `path` on disk)."""
    all_projects = scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)
    project = next((p for p in all_projects if p.id == project_id), None)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    return project


# -- Attachments per project (filesystem-only, no sessions.db table — see
# attachments.py for the on-disk layout/contract) ----------------------------


@app.post(
    "/api/projects/{project_id:path}/attachments",
    response_model=AttachmentUploadResult,
    status_code=201,
)
async def upload_attachments(project_id: str, files: list[UploadFile] = File(...)):
    project = _resolve_project_or_404(project_id)
    return await save_attachments(project.path, files)


@app.get("/api/projects/{project_id:path}/attachments")
async def get_attachments(project_id: str):
    project = _resolve_project_or_404(project_id)
    return {"attachments": list_attachments(project.path)}


@app.delete("/api/projects/{project_id:path}/attachments/{attachment_id}")
async def remove_attachment(project_id: str, attachment_id: str):
    project = _resolve_project_or_404(project_id)
    deleted = delete_attachment(project.path, attachment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Attachment not found: {attachment_id}")
    return {"status": "deleted", "project_id": project_id, "attachment_id": attachment_id}


def _validate_agent_cmd(agent: Agent) -> None:
    if not agent.cmd or not any(part.strip() for part in agent.cmd):
        raise HTTPException(status_code=422, detail="cmd não pode ser vazio")


@app.get("/api/agents", response_model=list[Agent])
async def list_global_agents():
    return await agent_store.list_all()


@app.post("/api/agents", response_model=Agent, status_code=201)
async def create_global_agent(body: Agent):
    _validate_agent_cmd(body)
    try:
        created = await agent_store.create(body)
    except ValueError:
        raise HTTPException(status_code=409, detail=f"Agent id already exists: {body.id}")
    await _reload_global_agents_cache()
    return created


@app.put("/api/agents/{agent_id}", response_model=Agent)
async def update_global_agent(agent_id: str, body: Agent):
    _validate_agent_cmd(body)
    updated = await agent_store.update(agent_id, body)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")
    await _reload_global_agents_cache()
    return updated


@app.delete("/api/agents/{agent_id}")
async def delete_global_agent(agent_id: str):
    ok = await agent_store.delete(agent_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")
    await _reload_global_agents_cache()
    return {"status": "deleted", "id": agent_id}


@app.get("/api/sessions/active")
async def sessions_active():
    now = asyncio.get_running_loop().time()
    meta = await store.get_all_meta()
    result = {}
    for session_key, proc in pty_manager.active_sessions().items():
        elapsed = now - proc.last_activity
        connected = session_key in _active_connections
        if not connected:
            status = "disconnected"
        elif elapsed < ACTIVITY_TIMEOUT:
            status = "running"
        else:
            status = "idle"

        # needs_attention não vem mais dessa transição running->idle (ADR-02
        # revisado) — é setado pelo hook Stop via POST /api/hooks/stop.
        session_meta = meta.get(session_key, {})
        result[session_key] = {
            "status": status,
            "connected": connected,
            "needs_attention": session_meta.get("needs_attention", False),
            "display_name": session_meta.get("display_name"),
        }
    return result


async def _dispatch_push_for_session(session_key: str) -> bool:
    """Decides whether this pause gets a Web Push and, if so, fires it.

    Returns whether a broadcast was scheduled (used by the tests; the caller
    ignores it).

    ⚠️ ORDER IS LOAD-BEARING (Risk R-1, the TOCTOU race on the ledger).
    `mark_push_notified` is awaited at DECISION time — before
    `create_task`, never in the send's success callback. Between the
    decision and the push service's answer there is a full round trip in
    which the frontend's 7s poll would still read `push_notified = 0` and
    play the local sound, and then the push would land on top of it: two
    audible alerts for one pause. Writing the mark first inverts the
    trade-off to the fail-safe side — if the delivery later fails, the local
    sound was suppressed for a notification that never arrived, which is the
    same "discard, don't defer" contract the quiet-hours window already uses.

    Every failure path here is swallowed: this runs inside the Stop hook,
    whose only real job is `mark_needs_attention`. A push problem can never
    make the hook fail.
    """
    if _vapid_keys is None:
        return False
    try:
        subscriptions = await push_store.list_all()
        # The genuine no-op path under decision G-1: with the keypair
        # generated at boot, "no keys" no longer happens — "nobody has
        # enabled push on any device" does.
        if not subscriptions:
            return False

        settings = await settings_store.get_notifications()
        offset_minutes = current_utc_offset_minutes()
        if is_within_quiet_hours(
            enabled=settings["quiet_hours_enabled"],
            start=settings["quiet_hours_start"],
            end=settings["quiet_hours_end"],
            now_epoch_seconds=time.time(),
            utc_offset_minutes=offset_minutes,
        ):
            # Not marked as notified: the push was discarded, so the local
            # sound decision stays entirely with the frontend (which applies
            # the same window itself).
            return False

        meta = await store.get_all_meta()
        payload = build_push_payload(session_key, meta.get(session_key, {}))
        await store.mark_push_notified(session_key)
        task = asyncio.create_task(
            send_push_to_all(payload, store=push_store, vapid_keys=_vapid_keys)
        )
        # Strong reference until completion (R-3) — asyncio itself only
        # keeps a weak one, so an unreferenced task can be collected in
        # flight and the push silently never leaves.
        _push_tasks.add(task)
        task.add_done_callback(_push_tasks.discard)
        return True
    except Exception as exc:
        print(f"==> AVISO: falha ao disparar push para {session_key}: {exc!r}", flush=True)
        return False


@app.post("/api/hooks/stop")
async def hook_stop(request: Request):
    """Fase 4 (ADR-02 revisado): callback do hook Stop do Claude Code,
    configurado em _build_pty_cmd via --settings. Disparado sempre que o
    agente termina uma resposta e volta a aguardar o usuário. O corpo é o
    stdin cru do hook (contém session_id = UUID da CLI, não a session_key do
    Escritório) — resolve pela mesma tabela que já mapeia os dois.

    Tem DOIS produtores hoje: além do hook Stop do `claude`, o
    `codex_notify_adapter.py` também POSTa aqui ao fim de cada turno do `codex`
    (registrado via `-c notify=[...]` no spawn, ver _build_codex_notify_argv),
    com o mesmo corpo `{"session_id": <uuid da CLI>}`.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    claude_session_id = payload.get("session_id")
    if claude_session_id:
        session_key = await store.get_session_key_by_claude_id(claude_session_id)
        if session_key:
            # Unconditional, and always first: the badge/title notification
            # is never silenced, not by quiet hours and not by push being
            # unavailable. This also resets push_notified, so the push
            # decision below starts from a clean slate for THIS pause.
            await store.mark_needs_attention(session_key)
            await _dispatch_push_for_session(session_key)
    return {"status": "ok"}


@app.get("/api/sessions/persisted")
async def sessions_persisted():
    """Fase 4 (ADR-01): todas as sessões guardadas em sessions.db — a fonte de
    verdade da lista "Chats Abertos", DIFERENTE de /api/sessions/active.

    /active só reporta processos PTY vivos neste momento (pty_manager, em
    memória) — é o que já sustenta o StatusDot e a reconciliação de
    montagem/desmontagem de terminais desde a Fase 3, e não deve mudar de
    semântica aqui. Uma sessão sobrevive no SQLite mesmo depois do PTY morrer
    (grace period, ou reinício do backend) até o usuário encerrar
    explicitamente — é isso que faz a lista "persistir entre dias" (critério
    de sucesso #2 da Fase 4), reabrir um item aqui reconecta via --resume.
    """
    return await store.get_all_meta()


@app.post("/api/sessions/{session_key:path}/ack")
async def ack_session(session_key: str):
    """Fase 4 (D-04): frontend chama ao focar uma sessão, zerando a
    notificação pendente. Sem checagem de 404 — no-op tolerável se a chave
    não existir, mesma tolerância a falha que o resto do fluxo de ack."""
    await store.ack(session_key)
    return {"status": "acked", "session_key": session_key}


@app.patch("/api/sessions/{session_key:path}/rename")
async def rename_session(session_key: str, body: RenameFrame):
    """Fase 4 (D-08/D-09): renomeia uma sessão via toque longo/duplo clique no
    frontend. Nome vazio/só espaços é rejeitado (400) — o frontend já filtra
    isso antes de chamar, esta é a segunda camada de defesa."""
    display_name = body.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name não pode ser vazio")
    await store.rename(session_key, display_name)
    return {"status": "renamed", "session_key": session_key, "display_name": display_name}


@app.post("/api/sessions/{session_key:path}/terminate")
async def terminate_session(session_key: str):
    """Terminates a PTY session (if one is running) and clears its stored
    session row. Returns 404 only when the session_key is unknown to BOTH the
    live PTY manager AND the persisted store (T-03-04).

    Fase 4: a session_key can be persisted in `store` (and therefore visible
    in the "Chats Abertos" list, ADR-01) with no live PTY at all — grace-period
    cleanup or a backend restart kills the process but the SQLite row survives
    on purpose. The old guard (`pty_manager.get() is None` -> 404) returned
    before `store.clear()` ever ran for exactly that case, so "Encerrar" on a
    disconnected chat silently failed to remove it from the list — it would
    reappear on the next /persisted poll. Checking `store` as a second source
    of "known" fixes this without weakening the 404 for genuinely unknown keys.
    """
    proc = pty_manager.get(session_key)
    known_in_store = await store.get(session_key) is not None
    if proc is None and not known_in_store:
        raise HTTPException(status_code=404, detail=f"No active session: {session_key}")
    if proc is not None:
        pty_manager.terminate(session_key)
    await store.clear(session_key)
    # Tarefas vivem no escopo da sessão — somem quando a sessão é encerrada
    # (decisão de produto fechada, ver plano do TL).
    await task_store.clear_for_session(session_key)
    _active_connections.pop(session_key, None)
    # Cancel the reader task before discarding the reference, mirroring the
    # eviction pattern in pty_endpoint. Without this, a task blocked on
    # websocket.receive() can linger until its socket closes. See 03-REVIEW WR-04.
    task = _active_tasks.pop(session_key, None)
    if task is not None and not task.done():
        task.cancel()
    _disconnect_times.pop(session_key, None)
    # `_session_locks` NÃO é limpo aqui de propósito: a entrada é removida pelo
    # próprio `_session_lock` quando o último usuário sai (refcount zero). Um
    # `pop` a partir deste teardown reabriria a corrida que o ADR-C5 fechou —
    # ver o docstring de `_session_lock` para o passo a passo.
    return {"status": "terminated", "session_key": session_key}


@app.post("/api/sessions/{session_key:path}/reset")
async def reset_session(session_key: str):
    """Bug 2 fix: confirmação explícita do usuário (botão "Iniciar nova
    conversa" no overlay de resume_failed) para descartar o claude_session_id
    mapeado e permitir uma sessão nova na próxima conexão. Diferente de
    /terminate: não remove a linha inteira do store, só zera a "memória" da
    CLI — display_name e needs_attention sobrevivem (ver
    ConversationStore.set(), que agora é um upsert real e preserva essas
    colunas no próximo `store.set()` do reconnect).

    Mesmo padrão de 404 do terminate_session acima: só quando session_key é
    desconhecido tanto de pty_manager quanto de store.
    """
    proc = pty_manager.get(session_key)
    known_in_store = await store.get(session_key) is not None
    if proc is None and not known_in_store:
        raise HTTPException(status_code=404, detail=f"No active session: {session_key}")
    # Idempotente e seguro mesmo se o processo já morreu sozinho (caso comum:
    # o resume_failed detectado acima já deixou o proc morto, sem removê-lo
    # de pty_manager — terminate() aqui só limpa a entrada).
    pty_manager.terminate(session_key)
    await store.reset_claude_session_id(session_key)
    # Mesma decisão de produto do /terminate: tarefas somem quando a sessão
    # é resetada (nova conversa = tarefas antigas não fazem mais sentido).
    await task_store.clear_for_session(session_key)
    return {"status": "reset", "session_key": session_key}


@app.post("/api/sessions/{session_key:path}/tasks", response_model=Task, status_code=201)
async def create_task(session_key: str, body: TaskCreateRequest):
    """Criação manual (UI) de uma tarefa de validação — mesmo TaskStore.create
    usado pelo fluxo via tool MCP (POST /api/hooks/task abaixo). Ação humana
    direta: body.projeto_id é propagado como está, SEM a validação
    "mesmo cliente" (resolve_projeto_alvo) — essa regra só vale para o caminho
    do agente (hook_task)."""
    task_id = await task_store.create(
        session_key, body.titulo, body.descricao_markdown, body.descricao_html,
        projeto_id=body.projeto_id,
    )
    tasks = await task_store.list_for_session(session_key)
    created = next(t for t in tasks if t["id"] == task_id)
    return Task(**created)


@app.get("/api/sessions/{session_key:path}/tasks", response_model=list[Task])
async def list_tasks(session_key: str):
    tasks = await task_store.list_for_session(session_key)
    return [Task(**t) for t in tasks]


@app.post("/api/sessions/{session_key:path}/tasks/{task_id}/done")
async def complete_task(session_key: str, task_id: int):
    """Idempotente: marcar uma tarefa já concluída como concluída de novo
    retorna 200 (sem re-escrever completed_at). 404 só quando o id não
    existe OU pertence a outra session_key — TaskStore.mark_done filtra por
    ambos no WHERE, então uma sessão não consegue concluir a tarefa de
    outra."""
    ok = await task_store.mark_done(session_key, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {"status": "done", "session_key": session_key, "task_id": task_id}


@app.post("/api/sessions/{session_key:path}/tasks/{task_id}/reopen")
async def reopen_task(session_key: str, task_id: int):
    """Espelha complete_task acima: desfaz uma conclusão (ex: usuário clicou
    sem querer). Mesmo padrão de 404/idempotência de mark_pending."""
    ok = await task_store.mark_pending(session_key, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {"status": "pending", "session_key": session_key, "task_id": task_id}


@app.get("/api/tasks/global", response_model=list[TaskGlobal])
async def list_tasks_global():
    """Tarefa 11 (05-ARQUITETO.md, ADR-9 da revisão 2, seção 9): visão global
    de tarefas de validação, agregando `tasks` de TODAS as sessões — a fonte
    de dado da tela `/tarefas`, diferente de GET /api/sessions/{key}/tasks
    (escopado a uma sessão só).

    NUNCA chama scan_projects — só dois SELECTs em SQLite:
    task_store.list_all() (todas as tarefas) e store.get_all_meta() (mesmo
    método já usado por GET /api/sessions/active, para display_name por
    session_key). projeto_id/agent_id são derivados de session_key via
    .partition("::"), mesmo padrão de continue_session acima — seguro mesmo
    se session_key não tiver "::" nenhum (retorna a string inteira como
    projeto_id e "" como agent_id, sem levantar exceção). O nome bonito do
    projeto NÃO é resolvido aqui: fica a cargo do frontend, casando
    projeto_id com /api/projects já existente (ADR-9)."""
    tasks = await task_store.list_all()
    meta = await store.get_all_meta()
    result = []
    for t in tasks:
        session_key = t["session_key"]
        # COALESCE: um projeto explícito (tarefa criada em outro sub-projeto do
        # mesmo cliente) vence; NULL cai no fallback pro projeto da própria
        # session_key. Só leitura de coluna + fallback de string — NUNCA chama
        # scan_projects (contrato ADR-9, coberto por teste).
        projeto_id = t["projeto_id"] or session_key.partition("::")[0]
        _, _, agent_id = session_key.partition("::")
        session_meta = meta.get(session_key, {})
        # projeto_id vem tanto em `t` (coluna) quanto resolvido aqui — remove do
        # spread pra não colidir com o kwarg explícito (coalescido).
        t_sem_projeto = {k: v for k, v in t.items() if k != "projeto_id"}
        result.append(TaskGlobal(
            **t_sem_projeto,
            projeto_id=projeto_id,
            agent_id=agent_id,
            session_display_name=session_meta.get("display_name"),
        ))
    return result


@app.post("/api/hooks/task")
async def hook_task(body: HookTaskRequest):
    """Callback do adaptador MCP (mcp_task_adapter.py), disparado pela tool
    `criar_tarefa_validacao` quando o agente pede validação ao usuário.

    Contrato de resposta (o adaptador MCP traduz cada caso em texto pro
    agente, ver mcp_task_adapter._format_result):
    - claude_session_id não resolve para session_key -> {"status": "ok"}
      (no-op silencioso; a sessão já foi encerrada, não é erro — mesmo padrão
      de hook_stop/hook_cards_create).
    - session_key resolve e a tarefa é criada -> {"success": True}.
    - session_key resolve mas a validação "mesmo cliente" rejeita o
      projeto_id pedido -> {"success": False, "error": "..."}.
    """
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}

    own_projeto_id = session_key.partition("::")[0]
    projects = scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)
    try:
        projeto_id = resolve_projeto_alvo(own_projeto_id, body.projeto_id, projects)
    except ValueError as e:
        return {"success": False, "error": str(e)}

    await task_store.create(
        session_key, body.titulo, body.descricao_markdown, body.descricao_html,
        projeto_id=projeto_id,
    )
    return {"success": True}


# -- Tarefa 6 (05-TL.md): CRUD de cards do board (Jira-like) ------------------
#
# CardStore NUNCA toca disco — quem grava/apaga arquivos de imagem é este
# módulo, aqui embaixo. CardImage.url também NUNCA é montado pelo CardStore
# (ver docstring do campo em models.py) — é sempre este endpoint que monta,
# via _card_image_url()/_hydrate_card_images().

_EXTENSION_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
}


def _card_image_url(card_id: int, filename: str) -> str:
    return f"/board_uploads/{card_id}/{filename}"


def _hydrate_card_images(card: dict) -> dict:
    """Monta a URL de cada CardImage embutida — do próprio card E de cada
    subcard embutido (list_top_level já traz subcards com suas próprias
    imagens, ver CardStore._list_active_subcards)."""
    card["imagens"] = [
        {**img, "url": _card_image_url(img["card_id"], img["filename"])}
        for img in card.get("imagens", [])
    ]
    card["subcards"] = [_hydrate_card_images(sub) for sub in card.get("subcards", [])]
    return card


async def _validate_card_status(status: str | None) -> str | None:
    """Validate `status` against the columns that actually exist. Returns the
    error message, or None if valid/absent.

    Shared by BOTH write paths, which differ only in how they report it:
    - UI/REST (create_card, create_subcard, update_card) -> HTTPException 400,
      via `_require_valid_card_status` below;
    - agent/MCP (hook_cards_create/move/update) -> {"success": False, "error"},
      because a raised 422/400 is swallowed by mcp_card_adapter._post_json and
      would reach the agent as a meaningless "connectivity error".

    This is what replaced the fixed `enum` the MCP tool schemas used to carry,
    and the column list is user-managed now, so nothing static can stand in for
    it. Without this check a card written to an unknown status simply
    DISAPPEARS: BoardV2 only renders columns it knows about, so the row is in
    the database, counted nowhere, visible nowhere. The valid slugs are spelled
    out in the error text on purpose — for the agent that message is the only
    discovery mechanism left, and inventing a whole "list columns" tool for it
    would be a bigger surface than the problem."""
    if status is None:
        return None
    columns = await card_store.list_columns()
    if any(c["slug"] == status for c in columns):
        return None
    validos = ", ".join(c["slug"] for c in columns)
    return f"Coluna '{status}' não existe. Colunas válidas: {validos}."


async def _require_valid_card_status(status: str | None) -> None:
    """UI/REST half of the check above: 400, same mapping the card endpoints
    already use for a ValueError out of CardStore."""
    erro = await _validate_card_status(status)
    if erro is not None:
        raise HTTPException(status_code=400, detail=erro)


@app.get("/api/cards", response_model=list[Card])
async def list_cards(projeto_id: list[str] | None = Query(default=None)):
    cards = await card_store.list_top_level(projeto_id)
    return [Card(**_hydrate_card_images(c)) for c in cards]


@app.post("/api/cards", response_model=Card, status_code=201)
async def create_card(body: CardCreateRequest):
    # `status` has a default of "a_fazer" here, so it is never absent — and
    # that default is itself a column the user is now free to rename away or
    # delete. Validated like any other value rather than trusted for being a
    # default.
    await _require_valid_card_status(body.status)
    try:
        card_id = await card_store.create(
            titulo=body.titulo,
            projeto_id=body.projeto_id,
            cliente_id=body.cliente_id,
            status=body.status,
            origem="bruno",
            ultima_atualizacao_por="bruno",
            descricao=body.descricao,
            tipo=body.tipo,
            prazo=body.prazo,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    created = await card_store.get(card_id)
    return Card(**created)


@app.post("/api/cards/{card_id}/subcards", response_model=Card, status_code=201)
async def create_subcard(card_id: int, body: SubcardCreateRequest):
    # Subcards were never covered indirectly: SubcardCreateRequest.status is a
    # free `str` with the same "a_fazer" default, so this path accepted any
    # value too. A subcard on an unknown status is worse than a top-level one —
    # it is not even counted in the parent's subcards_resumo, which compares
    # against the done column.
    await _require_valid_card_status(body.status)
    try:
        subcard_id = await card_store.create(
            titulo=body.titulo,
            # projeto_id é ignorado pelo CardStore quando parent_id é
            # passado — sempre derivado do pai (ver CardStore.create).
            projeto_id="",
            status=body.status,
            origem="bruno",
            ultima_atualizacao_por="bruno",
            descricao=body.descricao,
            tipo=body.tipo,
            parent_id=card_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    created = await card_store.get(subcard_id)
    return Card(**created)


@app.patch("/api/cards/{card_id}", response_model=Card)
async def update_card(card_id: int, body: CardUpdateRequest):
    # None here means "status did not come in the PATCH" (same semantics as
    # CardStore.update), and _validate_card_status passes it through untouched.
    await _require_valid_card_status(body.status)
    updated = await card_store.update(
        card_id,
        ultima_atualizacao_por="bruno",
        **body.model_dump(exclude_none=True),
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Card not found: {card_id}")
    return Card(**updated)


@app.delete("/api/cards/{card_id}")
async def delete_card(card_id: int):
    result = await card_store.soft_delete(card_id)
    return {"subcards_afetados": result["subcards_afetados"]}


@app.post("/api/cards/{card_id}/images", response_model=CardImage, status_code=201)
async def upload_card_image(card_id: int, file: UploadFile = File(...)):
    card = await card_store.get(card_id)
    if card is None or card["deleted_at"] is not None:
        raise HTTPException(status_code=404, detail=f"Card not found: {card_id}")

    try:
        data = await validate_upload_stream(file, max_bytes=5 * 1024 * 1024)
    except UploadTooLargeError:
        raise HTTPException(status_code=413, detail="Upload excede o limite de 5MB")

    mime_type = sniff_image_type(data[:12])
    if mime_type is None:
        raise HTTPException(
            status_code=400, detail="Arquivo não reconhecido como imagem válida"
        )

    ext = _EXTENSION_BY_MIME.get(mime_type, "bin")
    filename = f"{uuid.uuid4()}.{ext}"

    try:
        image_id = await card_store.add_image(card_id, filename, mime_type, len(data))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Só grava em disco DEPOIS de confirmado no banco (ordem proposital —
    # mesmo raciocínio de ADR-6 citado em 05-ARQUITETO.md: se a escrita em
    # disco falhar aqui, a linha em card_images já existe e a inconsistência
    # é "imagem listada sem arquivo", não o inverso mais silencioso "arquivo
    # órfão sem registro").
    card_dir = os.path.join(BOARD_UPLOADS_ROOT, str(card_id))
    os.makedirs(card_dir, exist_ok=True)
    with open(os.path.join(card_dir, filename), "wb") as f:
        f.write(data)

    return CardImage(
        id=image_id,
        card_id=card_id,
        filename=filename,
        url=_card_image_url(card_id, filename),
        mime_type=mime_type,
        size_bytes=len(data),
        criado_em=time.time(),
    )


@app.delete("/api/cards/{card_id}/images/{image_id}")
async def delete_card_image(card_id: int, image_id: int):
    filename = await card_store.delete_image(card_id, image_id)
    if filename is None:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")
    try:
        os.remove(os.path.join(BOARD_UPLOADS_ROOT, str(card_id), filename))
    except (FileNotFoundError, OSError):
        pass
    return {"status": "deleted", "card_id": card_id, "image_id": image_id}


@app.get("/api/cards/limpar-concluidos/preview", response_model=LimparConcluidosResult)
async def preview_limpar_concluidos(projeto_id: str):
    result = await card_store.preview_limpar_concluidos(projeto_id)
    return LimparConcluidosResult(
        cards=result["cards"], imagens=result["imagens"], imagens_com_falha=0
    )


@app.post("/api/cards/limpar-concluidos", response_model=LimparConcluidosResult)
async def executar_limpar_concluidos(projeto_id: str):
    result = await card_store.executar_limpar_concluidos(projeto_id)
    imagens_com_falha = 0
    for affected_card_id, filename in result["filenames_apagados"]:
        try:
            os.remove(os.path.join(BOARD_UPLOADS_ROOT, str(affected_card_id), filename))
        except (FileNotFoundError, OSError):
            imagens_com_falha += 1
    return LimparConcluidosResult(
        cards=result["cards"],
        imagens=result["imagens"],
        imagens_com_falha=imagens_com_falha,
    )


# -- Colunas do board (task #43, Fase 1) -------------------------------------
#
# Superfície EXCLUSIVA do Bruno (UI). Nenhuma tool MCP gerencia coluna: um
# agente só move card entre colunas que já existem (decisão de produto). Por
# isso estes endpoints falham com HTTPException normal (4xx), em vez do
# {"success": False, "error": ...} que os hooks de agente usam.


@app.get("/api/board/columns", response_model=list[BoardColumn])
async def list_board_columns():
    return [BoardColumn(**c) for c in await card_store.list_columns()]


@app.post("/api/board/columns", response_model=BoardColumn, status_code=201)
async def create_board_column(body: BoardColumnCreateRequest):
    try:
        created = await card_store.create_column(body.label)
    except ValueError as e:
        # 409, não 400: o pedido está bem formado, o que colide é o estado
        # atual do board (já existe uma coluna com esse nome).
        raise HTTPException(status_code=409, detail=str(e))
    return BoardColumn(**created)


@app.patch("/api/board/columns/{slug}", response_model=BoardColumn)
async def update_board_column(slug: str, body: BoardColumnUpdateRequest):
    """Só o label. O slug é imutável — ver CardStore.update_column_label."""
    try:
        updated = await card_store.update_column_label(slug, body.label)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Coluna não encontrada: {slug}")
    return BoardColumn(**updated)


@app.post("/api/board/columns/reorder", response_model=list[BoardColumn])
async def reorder_board_columns(body: BoardColumnReorderRequest):
    """`slugs` é a ordem INTEIRA, não um par trocado. Uma lista que não é
    permutação exata do conjunto atual vira 409: o cliente está operando sobre
    uma leitura obsoleta (outra aba criou/excluiu uma coluna), e aplicar o que
    ele mandou deixaria colunas com position antiga intercaladas."""
    try:
        columns = await card_store.reorder_columns(body.slugs)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return [BoardColumn(**c) for c in columns]


@app.post("/api/board/columns/{slug}/done", response_model=list[BoardColumn])
async def set_board_done_column(slug: str):
    """Rádio, não toggle: marca esta coluna como a concluída e desmarca a
    anterior. Devolve o board inteiro porque DUAS linhas mudaram."""
    try:
        columns = await card_store.set_done_column(slug)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [BoardColumn(**c) for c in columns]


@app.delete("/api/board/columns/{slug}")
async def delete_board_column(slug: str):
    """Os três motivos de recusa viajam DISCRIMINADOS em `detail.reason` (e
    `detail.cards` na contagem), não só no texto: o frontend mostra um diálogo
    diferente para cada um, e casar por prosa quebraria na primeira mudança de
    redação."""
    try:
        result = await card_store.delete_column(slug)
    except ColumnDeleteError as e:
        raise HTTPException(
            status_code=409,
            detail={"reason": e.reason, "message": str(e), "cards": e.cards},
        )
    if result is None:
        raise HTTPException(status_code=404, detail=f"Coluna não encontrada: {slug}")
    return {"status": "deleted", "slug": slug}


# -- Tarefa 7 (05-TL.md): hooks do agente para o Board (criar_card/mover_card) -
#
# Consumidos pelo adaptador MCP (mcp_card_adapter.py, Tarefa 8 — ainda não
# existe), não pela UI REST. Diferente de POST /api/hooks/task (silencioso
# em qualquer falha): aqui uma violação de regra de negócio (ValueError do
# CardStore, ou permissão negada) retorna {"success": False, "error": "..."}
# — a requisição chegou e foi processada, só rejeitada; é assim que o
# adapter consegue repassar uma mensagem de erro legível ao agente. Só a
# resolução de claude_session_id -> session_key desconhecida é que continua
# sendo um no-op silencioso, mesmo padrão de hook_task/hook_stop (a sessão
# pode já ter sido encerrada quando o hook chega).


def _agent_same_cliente(card: dict, own_projeto_id: str) -> bool:
    """Predicado ÚNICO de autorização de agente sobre um card existente —
    compartilhado por mover/editar/excluir/ver (hook_cards_move,
    hook_cards_update, hook_cards_delete, hook_cards_get).

    Decisão de produto (Bruno, definitiva): qualquer agente pode
    mover/editar/excluir/ler QUALQUER card — independente de qual agente o
    criou ou de a qual sessão ele está vinculado. A restrição por agent_id
    (origem == "agente:{agent_id}") e por session_key foi REMOVIDA de
    propósito: o cenário que motivou a mudança é "o Claude abre o card mas o
    Gemini termina", e agent_id é GLOBAL entre clientes/projetos (vem do
    Global Agent Registry), então nunca isolou nada de fato.

    A ÚNICA restrição que sobra é a mesma regra "mesmo cliente" já usada em
    resolve_projeto_alvo / hook_cards_create: o card precisa pertencer ao
    mesmo cliente do projeto da sessão atual do agente. cliente_id derivado
    via cliente_id_from_projeto_id (reaproveitada, não duplicada). Não há
    mais regra extra para o status 'feito' — mover para 'feito' segue a
    mesma regra de qualquer outro status (o Gemini que terminou o card do
    Claude precisa conseguir concluí-lo).

    Nos hooks que alteram ou leem um card, este predicado é avaliado ANTES da
    operação (nunca depois): responder "pertence a outro cliente" só quando o
    card existe já é informação demais, mas aplicar a regra depois do
    update/delete alteraria dados de outro cliente antes de recusar."""
    return (
        cliente_id_from_projeto_id(card["projeto_id"])
        == cliente_id_from_projeto_id(own_projeto_id)
    )


def _validate_card_tipo(tipo: str | None) -> str | None:
    """Validate `tipo` on the AGENT PATH (hooks). Returns the error message,
    or None if valid. `None` = field absent; `""` = the "clear" sentinel
    (both pass). A `raise HTTPException` here would turn into a "connectivity
    error" in the MCP adapter (_post_json swallows the 422) — so the handler
    returns {"success": False, "error": ...} carrying this string instead."""
    if tipo is not None and tipo != "" and tipo not in CARD_TIPOS:
        return f"tipo inválido: '{tipo}'. Use bug, hotfix ou historia."
    return None


@app.post("/api/hooks/cards/create")
async def hook_cards_create(body: HookCardCreateRequest):
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    # Cheap failure first: validate `tipo` before resolving project/parent.
    tipo_erro = _validate_card_tipo(body.tipo)
    if tipo_erro is not None:
        return {"success": False, "error": tipo_erro}

    status_erro = await _validate_card_status(body.status)
    if status_erro is not None:
        return {"success": False, "error": status_erro}

    # An agent may MOVE a card to the done column, but never OPEN one there:
    # a card born done was never actually done by anybody. The old fixed enum
    # on `criar_card` (["a_fazer", "em_andamento"]) enforced this implicitly;
    # removing the enum would have silently dropped the rule with it.
    done_slug = await card_store.get_done_slug()
    if done_slug is not None and body.status == done_slug:
        return {
            "success": False,
            "error": (
                f"Não é possível criar um card direto na coluna concluída "
                f"('{done_slug}'). Crie em outra coluna e mova depois."
            ),
        }

    own_projeto_id, _, agent_id = session_key.partition("::")

    if body.parent_id is not None:
        # SUBCARD: o projeto_id efetivo vem SEMPRE do card pai — o CardStore
        # descarta projeto_id/cliente_id quando parent_id está presente (regra
        # de integridade estrutural, ver CardStore.create). Por isso a
        # validação "mesmo cliente" NÃO pode recair sobre body.projeto_id
        # (que seria ignorado): tem que recair sobre o projeto do PAI. Sem
        # isto, um agente de clienteA cria um subcard sob um card de clienteB
        # só informando parent_id (card_id é AUTOINCREMENT, trivialmente
        # enumerável) — vazamento cross-tenant real (bug P0 reportado pelo QA).
        parent = await card_store.get(body.parent_id)
        if parent is None or parent["deleted_at"] is not None:
            return {
                "success": False,
                "error": f"Card pai {body.parent_id} não existe ou foi removido",
            }
        parent_projeto_id = parent["projeto_id"]
        # Mesmo padrão de comparação de cliente usado dentro de
        # resolve_projeto_alvo — reaproveitado, não duplicado.
        if cliente_id_from_projeto_id(parent_projeto_id) != cliente_id_from_projeto_id(own_projeto_id):
            return {
                "success": False,
                "error": f"Card pai {body.parent_id} pertence a outro cliente",
            }
        # Ambiguidade: se o agente mandou parent_id E projeto_id explícito e os
        # dois apontam para projetos diferentes, o CardStore usaria o do pai
        # silenciosamente. Preferimos erro bloqueante a resolver de forma
        # inesperada — o pedido é contraditório.
        if body.projeto_id and body.projeto_id != parent_projeto_id:
            return {
                "success": False,
                "error": (
                    f"parent_id {body.parent_id} pertence ao projeto "
                    f"'{parent_projeto_id}', inconsistente com projeto_id "
                    f"'{body.projeto_id}' informado"
                ),
            }
        projeto_id = parent_projeto_id
    else:
        # Card de topo: mesma validação "mesmo cliente" de hook_task (Tarefa 3)
        # — o agente pode pedir um sub-projeto diferente via body.projeto_id,
        # mas só do próprio cliente.
        projects = scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)
        try:
            projeto_id = resolve_projeto_alvo(own_projeto_id, body.projeto_id, projects)
        except ValueError as e:
            return {"success": False, "error": str(e)}

    origem = f"agente:{agent_id}"
    try:
        card_id = await card_store.create(
            titulo=body.titulo,
            projeto_id=projeto_id,
            status=body.status,
            descricao=body.descricao,
            origem=origem,
            ultima_atualizacao_por=origem,
            parent_id=body.parent_id,
            session_key=session_key,
            tipo=body.tipo,
        )
    except ValueError as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "card_id": card_id}


@app.post("/api/hooks/cards/move")
async def hook_cards_move(body: HookCardMoveRequest):
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    own_projeto_id, _, agent_id = session_key.partition("::")
    card = await card_store.get(body.card_id)
    if card is None or card["deleted_at"] is not None:
        return {"success": False, "error": f"Card {body.card_id} não existe ou foi removido"}

    if not _agent_same_cliente(card, own_projeto_id):
        return {
            "success": False,
            "error": f"Card {body.card_id} pertence a outro cliente",
        }

    status_erro = await _validate_card_status(body.novo_status)
    if status_erro is not None:
        return {"success": False, "error": status_erro}

    origem = f"agente:{agent_id}"
    await card_store.update(body.card_id, status=body.novo_status, ultima_atualizacao_por=origem)
    return {"success": True}


# -- Fase 3: hooks de edição/exclusão/consulta de card -----------------------
#
# Mesmas invariantes dos hooks acima, nesta ordem exata em update/delete/get:
# 1. sessão não resolvida -> {"status": "ok"} (no-op silencioso);
# 2. card inexistente ou soft-deletado -> {"success": False, ...};
# 3. card de outro cliente -> {"success": False, ...} ANTES de tocar no card.
# Espelham PATCH/DELETE /api/cards/{card_id} (uso da UI), com duas diferenças
# deliberadas: resolução de sessão + regra "mesmo cliente" (que a UI não tem,
# porque o Bruno enxerga todos os clientes), e checagem de existência no
# delete — que o DELETE REST não faz (devolve sucesso para id inexistente).


@app.post("/api/hooks/cards/update")
async def hook_cards_update(body: HookCardUpdateRequest):
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    own_projeto_id, _, agent_id = session_key.partition("::")
    card = await card_store.get(body.card_id)
    if card is None or card["deleted_at"] is not None:
        return {"success": False, "error": f"Card {body.card_id} não existe ou foi removido"}

    if not _agent_same_cliente(card, own_projeto_id):
        return {
            "success": False,
            "error": f"Card {body.card_id} pertence a outro cliente",
        }

    tipo_erro = _validate_card_tipo(body.tipo)
    if tipo_erro is not None:
        return {"success": False, "error": tipo_erro}

    status_erro = await _validate_card_status(body.status)
    if status_erro is not None:
        return {"success": False, "error": status_erro}

    # Um update sem nenhum campo de conteúdo ainda toca atualizado_em e
    # ultima_atualizacao_por — mesmo comportamento do PATCH REST (update_card),
    # mantido por paridade em vez de virar uma rejeição que o plano não pediu.
    # `tipo` is in the include; `prazo` is left out on purpose (AD-11 — outside
    # the MCP). exclude_none still lets the "" sentinel through (CardStore.update
    # turns it into NULL).
    campos = body.model_dump(
        include={"titulo", "descricao", "status", "tipo"}, exclude_none=True
    )
    updated = await card_store.update(
        body.card_id,
        ultima_atualizacao_por=f"agente:{agent_id}",
        **campos,
    )
    if updated is None:
        # CardStore.update revalida existência: só cai aqui se o card foi
        # apagado entre o get() acima e o update. Não pode virar
        # {"success": True, "card": null} — seria confirmar uma edição que
        # não aconteceu.
        return {"success": False, "error": f"Card {body.card_id} não existe ou foi removido"}
    return {"success": True, "card": updated}


@app.post("/api/hooks/cards/delete")
async def hook_cards_delete(body: HookCardDeleteRequest):
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    own_projeto_id, _, _ = session_key.partition("::")
    card = await card_store.get(body.card_id)
    if card is None or card["deleted_at"] is not None:
        return {"success": False, "error": f"Card {body.card_id} não existe ou foi removido"}

    if not _agent_same_cliente(card, own_projeto_id):
        return {
            "success": False,
            "error": f"Card {body.card_id} pertence a outro cliente",
        }

    result = await card_store.soft_delete(body.card_id)
    return {"success": True, "subcards_afetados": result["subcards_afetados"]}


@app.post("/api/hooks/cards/get")
async def hook_cards_get(body: HookCardGetRequest):
    """Retorna os campos CRUS do card (CardStore.get), sem hidratar
    subcards/imagens — decisão fechada com o Bruno: ver_card espelha a linha
    da tabela, quem quer a árvore usa listar_cards."""
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    own_projeto_id, _, _ = session_key.partition("::")
    card = await card_store.get(body.card_id)
    if card is None or card["deleted_at"] is not None:
        return {"success": False, "error": f"Card {body.card_id} não encontrado"}

    if not _agent_same_cliente(card, own_projeto_id):
        return {
            "success": False,
            "error": f"Card {body.card_id} pertence a outro cliente",
        }

    return {"success": True, "card": card}


@app.post("/api/hooks/cards/list")
async def hook_cards_list(body: HookCardListRequest):
    """Sem projeto_id: todos os cards de topo do CLIENTE da sessão. Com
    projeto_id: só aquele projeto, validado por resolve_projeto_alvo — que já
    garante "existe" + "mesmo cliente", então não há checagem duplicada aqui.

    A lista vazia é sucesso (`success: True`, `cards: []`), nunca erro: o
    adapter precisa distinguir "nenhum card" de "sessão não resolvida"."""
    session_key = await store.get_session_key_by_claude_id(body.claude_session_id)
    if not session_key:
        return {"status": "ok"}  # no-op silencioso, mesmo padrão de hook_task/hook_stop

    own_projeto_id, _, _ = session_key.partition("::")

    # Truthy, não `is not None`: projeto_id="" vindo do adapter significa
    # "não informado", e resolve_projeto_alvo trataria string vazia como
    # "usa o projeto atual" — silenciosamente estreitando uma listagem que
    # deveria abranger o cliente inteiro.
    if body.projeto_id:
        projects = scan_projects(PROJECTS_ROOT, global_agents=_global_agents_cache)
        try:
            projeto_id = resolve_projeto_alvo(own_projeto_id, body.projeto_id, projects)
        except ValueError as e:
            return {"success": False, "error": str(e)}
        cards = await card_store.list_top_level([projeto_id])
    else:
        cards = await card_store.list_by_cliente(
            cliente_id_from_projeto_id(own_projeto_id)
        )

    return {"success": True, "cards": cards, "total": len(cards)}


@app.post("/api/sessions/{session_key:path}/continue")
async def continue_session(session_key: str):
    """"Continuar": reenvia uma mensagem padrão pro PTY da sessão. Sempre
    disponível, nunca bloqueia mesmo com tarefas pendentes (decisão de
    produto fechada) — nunca retorna 4xx/5xx pro frontend por "sessão não
    está pronta". _ensure_pty garante um PTY vivo, spawnando uma sessão nova
    na pior hipótese (comportamento aceito pelo TL); se o --resume dessa
    sessão nova falhar (claude_session_id inválido), proc.write() levanta
    RuntimeError("PTY closed") — engolido aqui de propósito, mesma tolerância
    a PTY morto que o ws_to_pty() do WebSocket já tem. _ensure_pty também pode
    levantar LookupError (agent_id explícito não resolvível — ver o guard em
    _ensure_pty) — pty_endpoint já reporta isso via frame de controle
    spawn_failed; aqui, sem conexão persistente pra mandar um frame, apenas
    engolimos do mesmo jeito e devolvemos status="no_agent" mantendo o
    contrato de nunca retornar 4xx/5xx.

    O mesmo vale para OSError: _ensure_pty pode falhar ANTES do spawn quando o
    id de sessão do agente precisa ser provisionado por subprocess
    (SessionProvisioningError, que é OSError — ver session_provisioner.py).
    Capturar só LookupError era suficiente enquanto nenhum tipo de agente fazia
    I/O pré-spawn; a partir do Cursor, deixaria a exceção virar um 500 do
    FastAPI e quebrar o contrato "nunca 4xx/5xx" prometido aqui em cima. O
    status é "provisioning_failed", distinto de "no_agent": os dois são
    "não deu, e não é culpa sua", mas a causa é diferente (agente inexistente vs.
    CLI do agente falhou) e o frontend não ramifica sobre o valor literal de
    `status` hoje, então introduzir um novo é seguro."""
    project_id, _, agent_id_raw = session_key.partition("::")
    agent_id = agent_id_raw or None
    try:
        proc, _, _, _ = await _ensure_pty(session_key, project_id, agent_id)
    except LookupError:
        return {"status": "no_agent", "session_key": session_key}
    except OSError as exc:
        return {
            "status": "provisioning_failed",
            "session_key": session_key,
            "detail": str(exc),
        }
    message = "Pode continuar — validei as tarefas pendentes.\r"
    try:
        await proc.write(message.encode())
    except RuntimeError:
        pass
    return {"status": "sent", "session_key": session_key}


@app.post("/api/sessions/{session_key:path}/paste")
async def paste_to_session(session_key: str, body: PasteRequest):
    """Mirrors continue_session above (same _ensure_pty resolution, same
    tolerance for a dead/never-spawned PTY), but writes `body.text` to the
    PTY verbatim — no \\r/newline appended. Used by AttachmentsMenu's "Usar
    no chat" action, which pastes an attachment's path into the prompt
    without submitting it. Same LookupError tolerance as continue_session
    above (unresolvable agent_id) — returns status="no_agent" instead of
    letting the guard's exception turn into a 4xx/5xx, e a mesma tolerância a
    OSError (falha de provisioning do id de sessão) devolvendo
    status="provisioning_failed" — ver a docstring de continue_session para o
    porquê de os dois status serem distintos."""
    project_id, _, agent_id_raw = session_key.partition("::")
    agent_id = agent_id_raw or None
    try:
        proc, _, _, _ = await _ensure_pty(session_key, project_id, agent_id)
    except LookupError:
        return {"status": "no_agent", "session_key": session_key}
    except OSError as exc:
        return {
            "status": "provisioning_failed",
            "session_key": session_key,
            "detail": str(exc),
        }
    try:
        await proc.write(body.text.encode())
    except RuntimeError:
        pass
    return {"status": "sent", "session_key": session_key}


@app.websocket("/ws/pty/{session_key:path}")
async def pty_endpoint(websocket: WebSocket, session_key: str):
    await websocket.accept()

    # 1. Single-reader eviction: Close old connection and cancel task
    if session_key in _active_connections:
        try:
            await _active_connections[session_key].close(code=1008, reason="New connection established")
        except Exception:
            pass

    if session_key in _active_tasks:
        old_task = _active_tasks[session_key]
        if not old_task.done():
            old_task.cancel()
            try:
                # Wait for the old task to cancel and clean up
                await asyncio.wait_for(old_task, timeout=1.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    _active_tasks[session_key] = asyncio.current_task()
    _active_connections[session_key] = websocket
    _disconnect_times.pop(session_key, None)

    try:
        first = await websocket.receive()
        text_data = first.get("text")
        if text_data is None:
            return
        init = InitFrame(**json.loads(text_data))

        # 2. PTY Reuse: Check if process is already running in background
        # (delegated to _ensure_pty — shared with POST .../continue).
        #
        # cmd[0] may be a value the user typed for their own interactive
        # shell (e.g. a "claude-work" alias/function defined in .zshrc) but
        # is registered here as a Global Agent's `cmd` (agent_store.py) — the
        # PTYProcess spawn (pty_manager.py) invokes it via subprocess.Popen
        # WITHOUT shell=True (by design — see Non-goals in
        # docs/superpowers/specs/2026-07-14-configuracao-global-de-agentes-design.md),
        # so it never sources shell rc files and can't resolve aliases/functions,
        # only real executables on PATH. That raises FileNotFoundError (an
        # OSError) synchronously inside PTYProcess.__init__. Left uncaught, it
        # would escape this handler's (WebSocketDisconnect, CancelledError)-only
        # except clause below, aborting the just-accepted WS with an unhandled
        # exception; the frontend's ws.onclose (TerminalPanel.jsx) can't tell
        # that abort apart from a network blip and reconnects unconditionally,
        # resending the same InitFrame, hitting this exact same failure again,
        # forever — the reconnect-storm "piscando" loop documented in
        # .planning/debug/claude-work-ws-reconnect-loop.md. Same fix shape as
        # the resume_failed control frame below: report the failure over the
        # still-open socket and idle instead of letting it crash the connection.
        try:
            proc, spawned, resume, agent = await _ensure_pty(
                session_key, init.project_id, init.agent_id,
                cols=init.cols, rows=init.rows,
            )
        # TimeoutError entra na tupla como cinto e suspensório do provisioning de
        # id de sessão (session_provisioner.py): o caminho conhecido já converte
        # `subprocess.TimeoutExpired` (que é SubprocessError, NÃO OSError) em
        # SessionProvisioningError, mas qualquer timeout futuro que chegue cru
        # aqui — um `asyncio.wait_for` acrescentado a esse caminho, por exemplo —
        # cairia fora do catch e reabriria o storm. No 3.11+ asyncio.TimeoutError
        # É TimeoutError, então uma entrada cobre as duas.
        #
        # Deliberadamente NÃO `except Exception`: isso mascararia erro de
        # programação (um TypeError numa refatoração futura) como falha amigável
        # ao usuário, e a próxima regressão viraria invisível.
        except (OSError, LookupError, TimeoutError) as exc:
            await websocket.send_text(json.dumps({
                "type": "spawn_failed",
                "session_key": session_key,
                "detail": str(exc),
            }))
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
            return
        if not spawned:
            # Se a geometria do cliente reconectando é diferente da última
            # geometria conhecida do processo, o scrollback gravado em
            # proc.snapshot() foi escrito sob a geometria ANTERIOR — replayá-lo
            # cru contra um grid xterm.js de tamanho diferente é exatamente o
            # que produz texto desconfigurado em agentes com alt-screen e
            # posicionamento absoluto de cursor (claude/agy). Nesse caso,
            # prefixamos com um clear de terminal para o xterm.js partir de um
            # estado limpo. Nunca suprimimos o snapshot — o processo do agente
            # pode estar ocioso num prompt e não redesenhar sozinho ao SIGWINCH,
            # e sem o snapshot a tela ficaria em branco.
            geometry_changed = init.cols != proc.cols or init.rows != proc.rows
            proc.resize(init.cols, init.rows)
            snapshot = proc.snapshot()
            if snapshot:
                if geometry_changed:
                    await websocket.send_bytes(b"\x1b[2J\x1b[3J\x1b[H" + snapshot)
                else:
                    await websocket.send_bytes(snapshot)
        else:
            # 2.1 Resume fallback: If the session ID does not exist in Claude CLI,
            # it prints "No conversation found with session ID" and exits. We
            # stream each chunk to the client AS IT ARRIVES (no buffering delay
            # for the common successful-resume path) while watching for that
            # exact string within an overall deadline. The deadline is a single
            # budget checked per-iteration — NOT a fixed per-read timeout —
            # because a fixed short per-read timeout (the previous 0.2s) breaks
            # out of the whole probe on the first quiet gap between chunks,
            # which is completely normal during Claude's own startup and made
            # this fallback miss the error under any real-world timing/load
            # (see .planning/debug — "chat não encontrado" recurring report).
            #
            # Quais agentes têm probe, e como se reconhece a falha de cada um,
            # vem de _RESUME_FAILURE_SIGNATURES (ver lá). Agentes ausentes do
            # registry (ex.: agy, terminal) não têm probe: eles não têm o
            # conceito de retomar um id específico, então não há falha de
            # retomada para detectar. `agent is None` cai no claude, coerente com
            # _build_agent_cmd, que também trata agente não resolvido como claude.
            signature = _RESUME_FAILURE_SIGNATURES.get(agent.ia if agent else "claude")
            if resume and signature:
                markers = signature["markers"]
                exit_is_failure = signature["exit_is_failure"]
                accumulated = b""
                resume_failed = False
                deadline = asyncio.get_running_loop().time() + 5.0
                while True:
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    try:
                        chunk = await proc.read(timeout=remaining)
                    except (asyncio.TimeoutError, TimeoutError):
                        break
                    if chunk == b"":
                        # Fim de saída = processo morreu. Para o claude isso é
                        # inconclusivo (ele imprime a mensagem e sai, e é a
                        # mensagem que decide), então só encerra o probe. Para um
                        # agente com exit_is_failure=True, morrer DENTRO da
                        # janela é o próprio sinal de que a retomada falhou.
                        resume_failed = exit_is_failure
                        break
                    accumulated += chunk
                    await websocket.send_bytes(chunk)
                    if any(marker in accumulated for marker in markers):
                        resume_failed = True
                        break

                if resume_failed:
                    # Bug 2 fix: NÃO recria a sessão automaticamente aqui.
                    # Fechar o socket neste ponto reabriria o storm de
                    # reconexão documentado em .planning/debug/ws-reconnect-storm.md
                    # — o cliente reconectaria sozinho, reenviaria o InitFrame,
                    # tentaria --resume de novo com o mesmo claude_session_id
                    # velho, falharia de novo, em loop. Em vez de
                    # store.clear() + pty_manager.terminate() + respawn
                    # automático, avisa o frontend via frame de controle
                    # (send_text — hoje o único uso de texto neste WS; toda
                    # saída de PTY viaja como send_bytes, então o frontend
                    # pode diferenciar os dois) e deixa a conexão aberta sem
                    # PTY por trás. `proc` já terminou sozinho (o processo
                    # claude imprimiu o erro e saiu), então o
                    # asyncio.gather(pty_to_ws(), ws_to_pty()) abaixo roda
                    # normalmente: pty_to_ws() recebe b"" da fila e sai do
                    # loop sem quebrar; ws_to_pty() continua vivo esperando
                    # mensagens do cliente. A recriação só acontece quando o
                    # usuário confirmar explicitamente via POST
                    # /api/sessions/{session_key}/reset (o frontend fecha o
                    # socket DEPOIS desse POST, nessa ordem, para a
                    # reconexão automática do onclose cair no branch
                    # resume=False e criar uma sessão limpa).
                    await websocket.send_text(json.dumps({
                        "type": "resume_failed",
                        "session_key": session_key,
                    }))

        async def pty_to_ws():
            while True:
                data = await proc.read()
                if not data:
                    break
                # A send can race an eviction-close: the single-reader eviction
                # block above closes the OLD connection before its reader/writer
                # tasks are guaranteed stopped (intentional — reordering to
                # cancel-then-close breaks the 1008 close code the frontend
                # depends on, see .planning/debug/ws-reconnect-storm.md). Treat
                # a send on an already-closed socket as a clean disconnect,
                # same as `if not data: break` above.
                try:
                    await websocket.send_bytes(data)
                except RuntimeError:
                    break

        async def ws_to_pty():
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if "bytes" in message and message["bytes"] is not None:
                    # Bug 1 fix (QA follow-up): after a resume_failed control frame
                    # is sent above, `proc` still refers to the now-dead PTYProcess
                    # (master_fd=None) — the socket is intentionally kept open
                    # without a PTY behind it (see resume_failed comment above) so
                    # the user can click "Iniciar nova conversa". The overlay only
                    # covers the top strip of the terminal, so a keystroke typed
                    # before that click still reaches here. PTYProcess.write()
                    # raises RuntimeError("PTY closed") in that state — treat it as
                    # a no-op (stray input into a dead PTY is simply discarded)
                    # instead of letting it escape as an unhandled task exception.
                    try:
                        await proc.write(message["bytes"])
                    except RuntimeError:
                        continue
                elif "text" in message and message["text"] is not None:
                    try:
                        frame = json.loads(message["text"])
                        if frame.get("type") == "resize":
                            rf = ResizeFrame(**frame)
                            proc.resize(rf.cols, rf.rows)
                    except (json.JSONDecodeError, ValidationError):
                        continue

        await asyncio.gather(pty_to_ws(), ws_to_pty())
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        # 3. Grace-period cleanup: Do NOT terminate PTY instantly.
        if _active_connections.get(session_key) == websocket:
            _active_connections.pop(session_key, None)
            if _active_tasks.get(session_key) == asyncio.current_task():
                _active_tasks.pop(session_key, None)

            dis_time = asyncio.get_running_loop().time()
            _disconnect_times[session_key] = dis_time

            # Grace period before process eviction: 5 minutes (300 seconds)
            async def cleanup_after_delay(s_key: str, disconnect_time: float, delay: float):
                await asyncio.sleep(delay)
                if s_key not in _active_connections:
                    if _disconnect_times.get(s_key) == disconnect_time:
                        pty_manager.terminate(s_key)
                        _disconnect_times.pop(s_key, None)

            asyncio.create_task(cleanup_after_delay(session_key, dis_time, CLEANUP_DELAY))


# Registrado por último de propósito: precisa vir depois de toda rota /api e
# /ws acima para não fazer sombra nelas (Starlette casa rotas na ordem de
# registro, e "/{full_path:path}" combina com qualquer coisa).
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # Precisa de rota própria, registrada ANTES do catch-all: vite build copia
    # frontend/public/favicon.svg pra a raiz de dist/ (não pra dist/assets/,
    # que é o único diretório montado acima), então sem isso "/favicon.svg"
    # cairia no spa_fallback e o browser receberia index.html no lugar do
    # ícone — o link em index.html ficaria mudo em produção.
    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(os.path.join(FRONTEND_DIST, "favicon.svg"))

    # PWA static assets — same reasoning as favicon.svg above: these must be
    # registered before the catch-all, or the browser would receive
    # index.html instead of the manifest/service worker/icons/fonts, and the
    # PWA would silently fail to be installable.
    app.mount(
        "/icons",
        StaticFiles(directory=os.path.join(FRONTEND_DIST, "icons")),
        name="pwa_icons",
    )

    # .woff2 is missing from mimetypes' built-in map on Windows/Python 3.12 —
    # without this, StaticFiles/FileResponse falls back to "text/plain" for
    # every font, which some browsers refuse to load as a webfont.
    mimetypes.add_type("font/woff2", ".woff2")
    app.mount(
        "/fonts",
        StaticFiles(directory=os.path.join(FRONTEND_DIST, "fonts")),
        name="webfonts",
    )

    @app.get("/manifest.webmanifest")
    async def pwa_manifest():
        return FileResponse(
            os.path.join(FRONTEND_DIST, "manifest.webmanifest"),
            media_type="application/manifest+json",
        )

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(
            os.path.join(FRONTEND_DIST, "sw.js"),
            media_type="text/javascript",
        )

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
