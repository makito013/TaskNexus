"""Pydantic models for TaskNexus."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class Agent(BaseModel):
    """An agent that can be deployed in a project."""
    id: str
    nome: str
    papel: str
    # Tipo do agente. Deliberadamente `str` livre (sem Literal/Enum): o campo é
    # a chave de dispatch de main._build_agent_cmd, que tem ramo próprio para
    # "claude", "terminal" e "cursor" e trata qualquer outro valor pelo ramo
    # genérico (--dangerously-skip-permissions/--prompt-interactive, hoje usado
    # pelo "gemini"/agy). Ou seja: um valor novo é cadastrável pela UI e já
    # funciona, sem migração de schema. Valores em uso hoje:
    #   "claude"   -> contrato --session-id/--resume + hook Stop + MCP
    #   "gemini"   -> ramo genérico
    #   "terminal" -> shell puro, nenhuma flag acrescentada
    #   "cursor"   -> id de sessão provisionado por `cursor-agent create-chat`
    #                 (app/session_provisioner.py) e retomado com --resume
    ia: str
    cmd: list[str] = ["claude"]  # comando executado no PTY
    env: dict[str, str] = {}   # variáveis de ambiente extras aplicadas ao spawn do PTY
                               # (mescladas sobre os.environ, sem passar por shell — ver
                               # pty_manager.py). Valores suportam %VAR%/$VAR (os.path.expandvars).
    default: bool = False
    system_prompt: str | None = None


class Project(BaseModel):
    """A project containing agents and sub-projects."""
    id: str          # slug do path relativo ao root (ex: "podesubir", "podesubir/teste")
    nome: str
    path: str        # caminho absoluto da pasta do projeto
    agentes: list[Agent] = []
    sub_projetos: list[str] = []   # ids dos sub-projetos diretos
    # Campo aditivo — primeiro segmento de `id` antes da 1ª "/" (ver
    # agent_discovery.cliente_id_from_projeto_id). Para um cliente sem
    # subpasta ("podesubir") ou um projeto solto na raiz
    # ("projeto_2"), cliente_id == id (nenhum "/" no meio).
    cliente_id: str = ""


class InitFrame(BaseModel):
    """First WebSocket frame on /ws/pty/{session_key}: spawns the PTY (D-04)."""
    type: str
    project_id: str
    agent_id: str | None = None
    cols: int = 80
    rows: int = 24

    @field_validator("cols", "rows")
    @classmethod
    def _bounds(cls, v: int) -> int:
        if not (1 <= v <= 65535):
            raise ValueError("cols and rows must be in range 1..65535")
        return v


class RenameFrame(BaseModel):
    """Body for PATCH /api/sessions/{session_key}/rename (D-08)."""
    display_name: str


class ResizeFrame(BaseModel):
    """Control frame dispatched to PTYProcess.resize() (D-05)."""
    type: str
    cols: int
    rows: int

    @field_validator("cols", "rows")
    @classmethod
    def _bounds(cls, v: int) -> int:
        if not (1 <= v <= 65535):
            raise ValueError("cols and rows must be in range 1..65535")
        return v


class TaskCreateRequest(BaseModel):
    """Body para POST /api/sessions/{session_key}/tasks — criação manual (UI)
    e também o corpo interno usado por POST /api/hooks/task (criação via
    tool MCP do agente)."""
    titulo: str
    descricao_markdown: str
    descricao_html: str | None = None
    # Criação manual (UI) pode vincular a tarefa a um sub-projeto específico.
    # Ação humana direta: NÃO passa pela validação "mesmo cliente"
    # (resolve_projeto_alvo) — essa regra só se aplica ao caminho do agente.
    projeto_id: str | None = None


class Task(BaseModel):
    """Tarefa de validação, escopada por session_key — some quando a sessão
    é limpa/resetada (ver TaskStore.clear_for_session)."""
    id: int
    session_key: str
    titulo: str
    descricao_markdown: str
    descricao_html: str | None = None
    status: str  # "pending" | "done"
    created_at: float
    completed_at: float | None = None
    # NULL = tarefa do próprio projeto da sessão (fallback via session_key na
    # leitura, ver GET /api/tasks/global).
    projeto_id: str | None = None


class HookTaskRequest(BaseModel):
    """Body para POST /api/hooks/task, chamado pelo adaptador MCP
    (mcp_task_adapter.py) rodando como processo filho do `claude` CLI —
    resolve session_key a partir do claude_session_id da CLI, mesmo padrão
    de HookStopRequest implícito em hook_stop."""
    claude_session_id: str
    titulo: str
    descricao_markdown: str
    descricao_html: str | None = None
    # Opcional: sub-projeto alvo do mesmo cliente (validado no backend via
    # resolve_projeto_alvo). Omitido -> projeto da conversa atual.
    projeto_id: str | None = None


class CardImage(BaseModel):
    """Anexo de imagem de um card/subcard. `url` é o path servido
    estaticamente (ex: /board_uploads/{card_id}/{filename}) — não persistido
    como coluna própria no banco (evita duplicar a fonte de verdade do path,
    que é sempre card_id + filename); é responsabilidade do endpoint montar
    esse campo ao construir a resposta, não deste modelo."""
    id: int
    card_id: int
    filename: str
    url: str
    mime_type: str
    size_bytes: int
    criado_em: float


class Card(BaseModel):
    """Card de board, persistente por projeto — DESACOPLADO de Task (tarefas
    de validação por sessão). `parent_id` NULL = card de topo. `subcards` e
    `subcards_resumo` só vêm populados quando este Card é retornado como card
    de TOPO por GET /api/cards — um subcard dentro do array `subcards` de um
    pai sempre tem `subcards=[]` (a regra de 1 nível garante isso por
    construção)."""
    id: int
    titulo: str
    projeto_id: str
    parent_id: int | None = None
    status: str  # "a_fazer" | "em_andamento" | "em_revisao" | "feito"
    origem: str  # "bruno" | "agente:{agent_id}"
    ultima_atualizacao_por: str
    descricao: str | None = None
    session_key: str | None = None
    criado_em: float
    atualizado_em: float
    deleted_at: float | None = None
    subcards: list["Card"] = []
    subcards_resumo: dict | None = None  # {"total": int, "feitos": int} ou None
    imagens: list[CardImage] = []


# Necessário em Pydantic v2 quando o módulo usa `from __future__ import
# annotations`: a auto-referência `list["Card"]` fica como string não
# resolvida até este rebuild explícito ser chamado — sem ele, a primeira
# validação de um Card levanta PydanticUndefinedAnnotation.
Card.model_rebuild()


class CardCreateRequest(BaseModel):
    """Body de POST /api/cards — criação de card de TOPO por Bruno via UI.
    Não tem parent_id: subcards têm endpoint próprio aninhado para impedir
    criar um subcard fora do contexto visual/lógico do pai.

    `projeto_id` e `cliente_id` são mutuamente complementares: um card
    vinculado a um projeto específico envia `projeto_id`; um card
    "cliente-only" (vinculado só ao cliente-pai, sem projeto específico)
    envia `cliente_id` e omite `projeto_id` — o backend resolve
    `projeto_id = cliente_id` (ver CardStore.create, ramo 3). Exigir pelo
    menos um dos dois é responsabilidade de CardStore.create, que levanta
    ValueError se nenhum vier — não deste modelo."""
    titulo: str
    projeto_id: str | None = None
    cliente_id: str | None = None
    status: str = "a_fazer"
    descricao: str | None = None


class SubcardCreateRequest(BaseModel):
    """Body de POST /api/cards/{card_id}/subcards. projeto_id e parent_id
    nunca vêm do body — projeto_id é derivado do pai, parent_id é o
    {card_id} do path."""
    titulo: str
    status: str = "a_fazer"
    descricao: str | None = None


class CardUpdateRequest(BaseModel):
    """Body de PATCH /api/cards/{card_id} — serve tanto card de topo quanto
    subcard, sem distinção."""
    titulo: str | None = None
    descricao: str | None = None
    status: str | None = None


class HookCardCreateRequest(BaseModel):
    """Body de POST /api/hooks/cards/create. `parent_id` é usado pelo agente
    para criar um subcard — diferente do caminho da UI, que usa
    /api/cards/{card_id}/subcards, o agente faz um POST plano (sem nesting
    de URL), então precisa vir no body."""
    claude_session_id: str
    titulo: str
    status: str = "a_fazer"
    descricao: str | None = None
    parent_id: int | None = None
    # Opcional: sub-projeto alvo do mesmo cliente (validado no backend via
    # resolve_projeto_alvo). Omitido -> projeto da conversa atual. Ignorado
    # quando parent_id vem junto (o projeto do subcard é sempre o do pai).
    projeto_id: str | None = None


class HookCardMoveRequest(BaseModel):
    """Mover um subcard usa exatamente o mesmo contrato de mover um card de
    topo."""
    claude_session_id: str
    card_id: int
    novo_status: str


class HookCardUpdateRequest(BaseModel):
    """Body de POST /api/hooks/cards/update — equivalente de agente do PATCH
    /api/cards/{card_id} (CardUpdateRequest), com card_id no body em vez do
    path (o adapter MCP faz sempre um POST plano) e claude_session_id para o
    backend resolver a session_key. Campos omitidos/None não são alterados,
    mesma semântica de CardStore.update."""
    claude_session_id: str
    card_id: int
    titulo: str | None = None
    descricao: str | None = None
    status: str | None = None


class HookCardDeleteRequest(BaseModel):
    """Body de POST /api/hooks/cards/delete. Soft delete — mesmo contrato
    mínimo de HookCardMoveRequest, só sem o campo de destino."""
    claude_session_id: str
    card_id: int


class HookCardGetRequest(BaseModel):
    """Body de POST /api/hooks/cards/get. Retorna os campos crus do card
    (CardStore.get), sem hidratar subcards/imagens."""
    claude_session_id: str
    card_id: int


class HookCardListRequest(BaseModel):
    """Body de POST /api/hooks/cards/list. `projeto_id` omitido -> todos os
    cards de topo do CLIENTE da sessão atual; informado -> só aquele projeto
    (validado como sendo do mesmo cliente via resolve_projeto_alvo). Não
    existe parâmetro cliente_id de propósito: a regra "mesmo cliente" já
    restringe o resultado ao cliente da sessão, um cliente_id explícito seria
    redundante ou uma tentativa de acesso cross-tenant."""
    claude_session_id: str
    projeto_id: str | None = None


class LimparConcluidosResult(BaseModel):
    """Resposta tanto do preview (GET) quanto da execução (POST) da limpeza
    de concluídos — mesmo formato, para o frontend reaproveitar o mesmo tipo
    sem duas modelagens paralelas. `imagens_com_falha` só é relevante na
    execução real (preview nunca toca em arquivo)."""
    cards: int
    imagens: int
    imagens_com_falha: int = 0


class AppearanceSettings(BaseModel):
    """Configuração global de aparência da aplicação (Milestone 1 do plano
    Layout v2, 05-TL.md) — linha única persistida por SettingsStore. Resposta
    de GET/PUT /api/settings/appearance."""
    layout_version: str
    theme_mode: str


class AppearanceUpdateRequest(BaseModel):
    """Body de PUT /api/settings/appearance — partial update: campos
    omitidos/None não alteram o valor persistido (ver SettingsStore.update)."""
    layout_version: str | None = None
    theme_mode: str | None = None

    @field_validator("layout_version")
    @classmethod
    def _valid_layout_version(cls, v: str | None) -> str | None:
        if v is not None and v not in ("v1", "v2"):
            raise ValueError("layout_version deve ser 'v1' ou 'v2'")
        return v

    @field_validator("theme_mode")
    @classmethod
    def _valid_theme_mode(cls, v: str | None) -> str | None:
        if v is not None and v not in ("dark", "light"):
            raise ValueError("theme_mode deve ser 'dark' ou 'light'")
        return v


class NotificationSettings(BaseModel):
    """Response of GET/PUT /api/settings/notifications — end-of-chat
    notification settings (sound + Web Notification on the open tab).

    `server_utc_offset_minutes` and `quiet_hours_active` are NOT columns:
    both are derived from the server's clock on every read. The offset
    travels in the contract because the quiet-hours window is defined in the
    SERVER's timezone — without it, the frontend opened from a phone in
    another timezone (via Tailscale) would compute the window at the wrong
    time. `quiet_hours_active` is the same decision already resolved on the
    backend (app/quiet_hours.py), useful for the frontend to confirm that
    the JS mirror agrees."""
    quiet_hours_enabled: bool
    quiet_hours_start: str
    quiet_hours_end: str
    server_utc_offset_minutes: int
    quiet_hours_active: bool


class NotificationSettingsUpdateRequest(BaseModel):
    """Body of PUT /api/settings/notifications — partial update, same
    contract as AppearanceUpdateRequest: an omitted/None field doesn't
    change the persisted value."""
    quiet_hours_enabled: bool | None = None
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None

    @field_validator("quiet_hours_start", "quiet_hours_end")
    @classmethod
    def _valid_time_of_day(cls, v: str | None) -> str | None:
        # Reject right at the edge instead of letting it into the database:
        # an invalid time would be treated as "never quiet" (fail-open of
        # quiet_hours.is_within_quiet_hours), and the user would never
        # discover that the window they configured is worthless.
        from .quiet_hours import parse_time_of_day

        if v is not None and parse_time_of_day(v) is None:
            raise ValueError("horário deve estar no formato HH:MM (24h)")
        return v


class PushSubscriptionKeys(BaseModel):
    """The `keys` object the browser's PushSubscription hands back. Both
    values are base64url strings produced by the browser — the server never
    interprets them, it only forwards them to pywebpush, so the validation
    here is just "present and not blank"."""
    p256dh: str
    auth: str

    @field_validator("p256dh", "auth")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("chave de subscription não pode ser vazia")
        return v


class PushSubscriptionRequest(BaseModel):
    """Body of POST /api/push/subscriptions — the browser's PushSubscription
    serialized as-is (`endpoint` + `keys`), plus the optional user agent used
    only to make the device recognizable in the database.

    Rejecting a blank/non-http endpoint at the edge matters: it becomes a
    PRIMARY KEY, and a junk row would be re-tried on every single push
    forever with no way for the user to notice."""
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: str | None = None

    @field_validator("endpoint")
    @classmethod
    def _valid_endpoint(cls, v: str) -> str:
        endpoint = v.strip()
        if not endpoint.startswith(("https://", "http://")):
            raise ValueError("endpoint deve ser uma URL http(s)")
        return endpoint


class PushSubscriptionDeleteRequest(BaseModel):
    """Body of DELETE /api/push/subscriptions. Only the endpoint is needed —
    it's the primary key."""
    endpoint: str


class VapidPublicKeyResponse(BaseModel):
    """Response of GET /api/push/vapid-public-key.

    `public_key` is the base64url applicationServerKey the browser needs in
    `pushManager.subscribe()`. It is nullable, with `available` alongside it,
    because push degrades instead of failing: on a machine without
    pywebpush/cryptography installed the key was never provisioned, and the
    UI has to be able to say "unavailable on this server" rather than choke
    on a 500."""
    public_key: str | None
    available: bool


class ProjectsRootSettings(BaseModel):
    """Resposta de GET/PUT /api/settings/projects-root. `projects_root_path`
    é o valor cru persistido (None = sem override); `resolved_path` é o
    valor efetivo já com o fallback aplicado (env var PROJECTS_ROOT /
    ~/projetos), pro frontend sempre ter algo pra mostrar mesmo sem
    customização ainda."""
    projects_root_path: str | None
    resolved_path: str


class ProjectsRootUpdateRequest(BaseModel):
    """Body de PUT /api/settings/projects-root."""
    projects_root_path: str


class Attachment(BaseModel):
    """A per-project file attachment. Filesystem is the sole source of
    truth — no table in sessions.db (see attachments.py). Lives under
    `{project_path}/.escritorio/attachments/{id}/{original_name}`."""
    id: str
    original_name: str
    size_bytes: int
    uploaded_at: str  # ISO 8601
    content_type: str | None = None
    path: str  # absolute path on disk


class AttachmentUploadResult(BaseModel):
    """Response of POST /api/projects/{project_id}/attachments. Partial
    success is always reportable: a multi-file batch can have some files
    saved (`attachments`) and others rejected (`errors`) at the same time —
    see attachments.save_attachments."""
    attachments: list[Attachment]
    errors: list[dict]


class PasteRequest(BaseModel):
    """Body of POST /api/sessions/{session_key}/paste. Unlike
    continue_session's fixed message, `text` is written verbatim to the
    active PTY — no trailing \\r/newline is added by the endpoint."""
    text: str


class TaskGlobal(Task):
    """Task de validação com o contexto de projeto/agente embutido — usado
    pela visão global de Tarefas (agrega tasks de todas as sessões,
    agrupadas por projeto), que não tem esse contexto disponível a partir de
    session_key sozinho sem re-resolver o projeto a cada leitura."""
    projeto_id: str
    agent_id: str
    session_display_name: str | None = None
