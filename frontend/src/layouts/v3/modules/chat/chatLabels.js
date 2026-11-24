// Pure view helpers of the chat screens (pt-BR texts of the Designer, section 3.2 and 6). No React,
// no I/O. The list row and the header chip read the same state function so they never disagree.

const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']
const MINUTE = 60
const HOUR = 3600
const DAY = 86400

// "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias", then "12 de out." `seconds` is an epoch in
// seconds (the chat store writes REAL seconds); `now` is injectable for tests.
export function relativeTime(seconds, now = Date.now()) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return ''
  const elapsed = Math.max(0, Math.floor(now / 1000 - seconds))
  if (elapsed < MINUTE) return 'agora'
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'ontem'
  if (days < 7) return `há ${days} dias`
  const date = new Date(seconds * 1000)
  return `${date.getDate()} de ${MONTHS[date.getMonth()]}`
}

// "HH:mm" of an epoch in seconds, local time.
export function clockTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return ''
  const date = new Date(seconds * 1000)
  const two = (value) => String(value).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

// "Concluído em 42 s" / "Concluído em 1 min 5 s", plus the cost when the turn reported one.
export function turnMeta(lastTurn) {
  if (!lastTurn || lastTurn.isError || typeof lastTurn.durationMs !== 'number') return ''
  const total = Math.max(0, Math.round(lastTurn.durationMs / 1000))
  const duration = total >= 60 ? `${Math.floor(total / 60)} min ${total % 60} s` : `${total} s`
  const cost = typeof lastTurn.costUsd === 'number' && lastTurn.costUsd > 0
    ? ` · US$ ${lastTurn.costUsd.toFixed(2).replace('.', ',')}`
    : ''
  return `Concluído em ${duration}${cost}`
}

// "0:42" of a running turn.
export function elapsedLabel(startedAt, now = Date.now()) {
  if (typeof startedAt !== 'number') return '0:00'
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The project label of a chat: the last segment of the registry key ("Pessoal/tn-sandbox" ->
// "tn-sandbox"). The screen has no registry; the key is what the backend gives.
export function projectLabel(projectRef) {
  const parts = String(projectRef ?? '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

const SHORT_REASON = {
  cli_not_found: 'claude não encontrado',
  cli_invalid: 'claude inválido',
  cli_version_unsupported: 'claude desatualizado',
  folder_unavailable: 'pasta não encontrada',
  connector_exposed: 'encerrado por segurança',
}

export function shortReason(reason) {
  return SHORT_REASON[reason] ?? 'Tente de novo.'
}

export const DEFAULT_TITLE = 'Nova conversa'
const TITLE_MAX = 60

// R-LISTA: the name, else the first message (clipped), else "Nova conversa".
export function chatTitle(session, firstMessage = '') {
  const name = typeof session?.display_name === 'string' ? session.display_name.trim() : ''
  if (name) return name
  const oneLine = String(firstMessage ?? '').replace(/\s+/g, ' ').trim()
  if (oneLine) return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1)}…` : oneLine
  return DEFAULT_TITLE
}

export const STATE_ORDER = ['needs_you', 'running', 'stopped', 'resumable', 'failed']

// State of one chat row (R-LISTA, priority order of the table). `overrides` comes from the open
// conversation, which knows more than the poll: { pendingCount, running, tool, attentionSeen }.
// Returns { state, label, accent, className, detail }.
export function chatStateOf(session, overrides = {}) {
  const pending = overrides.pendingCount ?? session?.pending_permissions ?? 0
  const running = overrides.running ?? session?.live_status === 'running'
  const awaiting = session?.live_status === 'awaiting_permission'
  const concluded = Boolean(session?.needs_attention) && !overrides.attentionSeen

  if (pending > 0 || awaiting || concluded) {
    let detail = 'Turno concluído'
    if (pending === 1) detail = '1 aprovação pendente'
    else if (pending > 1) detail = `${pending} aprovações pendentes`
    return { state: 'needs_you', label: 'Precisa de você', accent: 'fin', className: '', detail }
  }
  if (running) {
    return {
      state: 'running',
      label: 'Rodando',
      accent: 'kan',
      className: '',
      detail: overrides.tool ? `Usando ${overrides.tool}` : 'Respondendo…',
    }
  }
  if (session?.status === 'failed' && !session?.live_status) {
    return {
      state: 'failed',
      label: 'Falhou ao iniciar',
      accent: 'danger',
      className: '',
      detail: shortReason(session?.last_error?.reason),
    }
  }
  if (session?.live_status === 'idle') {
    return {
      state: 'stopped',
      label: 'Parado',
      accent: undefined,
      className: 'v3-projects-state--stopped',
      detail: 'Aguardando sua mensagem',
    }
  }
  const when = relativeTime(session?.updated_at, overrides.now)
  return {
    state: 'resumable',
    label: 'Retomável',
    accent: undefined,
    className: 'v3-projects-state--free',
    detail: when ? `Última atividade ${when}` : 'Última atividade desconhecida',
  }
}

// Chats in the order of the table (needs you, running, stopped, resumable, failed), the most
// recent first inside each state. Rows keep their own object; the state is returned beside.
export function orderChats(sessions, overridesByKey = {}) {
  return sessions
    .map((session) => ({ session, info: chatStateOf(session, overridesByKey[session.session_key]) }))
    .sort((a, b) => {
      const rank = STATE_ORDER.indexOf(a.info.state) - STATE_ORDER.indexOf(b.info.state)
      if (rank !== 0) return rank
      return (b.session.updated_at ?? 0) - (a.session.updated_at ?? 0)
    })
}

// Fixed label of the permission mode chip (Designer 4.1: "Pede aprovação" for the default mode).
const MODE_LABELS = {
  default: 'Pede aprovação',
  acceptEdits: 'Aceita edições',
  plan: 'Modo plano',
}

export function modeLabel(mode) {
  return MODE_LABELS[mode] ?? MODE_LABELS.default
}

// Island phrase and pet state of the chat route (Designer 3.1).
export function islandFor({ agentName, pendingCount, running, failed, notFound }) {
  const name = agentName || 'O agente'
  if (notFound) return { message: 'Essa conversa não foi encontrada.', state: 'alert' }
  if (failed) return { message: 'Esse chat não abriu. Veja o aviso.', state: 'alert' }
  if (pendingCount > 0) return { message: `${name} está esperando você.`, state: 'alert' }
  if (running) return { message: `${name} está trabalhando. Aviso quando terminar.`, state: 'thinking' }
  return { message: `Chat aberto com ${name}.`, state: 'idle' }
}

// How a permission card stands, from the card of the reducer and this client's own decision
// (useChatSession `decisions[card.id]`). Shared by every kind of card (tool, question, plan).
//   pending | sending | error | allowed | allowed_session | denied | denied_stop | elsewhere
//   | expired | cancelled
export function cardStatus(card, decision) {
  if (card.status === 'pending') {
    if (decision?.phase === 'error') return 'error'
    return decision ? 'sending' : 'pending'
  }
  if (card.status === 'allowed') {
    if (card.decidedElsewhere) return 'elsewhere'
    return card.scope === 'session' ? 'allowed_session' : 'allowed'
  }
  if (card.status === 'denied') {
    if (card.decidedElsewhere) return 'elsewhere'
    return decision?.kind === 'denyStop' ? 'denied_stop' : 'denied'
  }
  if (card.status === 'expired') return 'expired'
  return 'cancelled'
}
