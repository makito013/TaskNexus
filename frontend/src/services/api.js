// frontend/src/services/api.js

const BASE = '/api'

export const api = {
  async fetchProjects() {
    const r = await fetch(`${BASE}/projects`)
    if (!r.ok) throw new Error('Falha ao buscar projetos')
    return r.json()
  },

  async fetchStatus() {
    const r = await fetch(`${BASE}/status`)
    if (!r.ok) throw new Error('Backend offline')
    return r.json()
  },

  async fetchActiveSessions() {
    const r = await fetch(`${BASE}/sessions/active`)
    if (!r.ok) throw new Error('Falha ao buscar sessões ativas')
    return r.json()
  },

  async fetchPersistedSessions() {
    const r = await fetch(`${BASE}/sessions/persisted`)
    if (!r.ok) throw new Error('Falha ao buscar chats abertos')
    return r.json()
  },

  async terminateSession(sessionKey) {
    // sessionKey may contain '/' (sub-project paths) — don't encode them so the
    // :path route param on the backend receives the full key correctly
    const r = await fetch(`${BASE}/sessions/${sessionKey}/terminate`, { method: 'POST' })
    // 404 = session already gone — treat as success (idempotent terminate)
    if (r.status === 404) return { status: 'already_gone' }
    if (!r.ok) throw new Error('Falha ao terminar sessão')
    return r.json()
  },

  async ackSession(sessionKey) {
    const r = await fetch(`${BASE}/sessions/${sessionKey}/ack`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao confirmar leitura da sessão')
    return r.json()
  },

  async renameSession(sessionKey, displayName) {
    const r = await fetch(`${BASE}/sessions/${sessionKey}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    })
    if (!r.ok) throw new Error('Falha ao renomear sessão')
    return r.json()
  },

  async resetSession(sessionKey) {
    // Bug 2 fix: descarta o claude_session_id mapeado após uma falha de
    // --resume (confirmação do usuário no overlay de resume_failed), sem
    // remover a sessão da lista "Chats Abertos" (diferente de terminateSession).
    const r = await fetch(`${BASE}/sessions/${sessionKey}/reset`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao reiniciar sessão')
    return r.json()
  },

  async fetchTasks(sessionKey) {
    // sessionKey may contain '/' (sub-project paths) — same convention as
    // terminateSession/renameSession/resetSession above, don't encode it.
    const r = await fetch(`${BASE}/sessions/${sessionKey}/tasks`)
    if (!r.ok) throw new Error('Falha ao buscar tarefas')
    return r.json()
  },

  async createTask(sessionKey, { titulo, descricao_markdown, descricao_html, projeto_id }) {
    // projeto_id é opcional (ação humana na UI — TaskCreateRequest.projeto_id,
    // str | None no backend). JSON.stringify descarta chaves `undefined`
    // sozinho, então basta repassá-lo: quando não vier, some do payload.
    const r = await fetch(`${BASE}/sessions/${sessionKey}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, descricao_markdown, descricao_html, projeto_id }),
    })
    if (!r.ok) throw new Error('Falha ao criar tarefa')
    return r.json()
  },

  async completeTask(sessionKey, taskId) {
    const r = await fetch(`${BASE}/sessions/${sessionKey}/tasks/${taskId}/done`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao concluir tarefa')
    return r.json()
  },

  async reopenTask(sessionKey, taskId) {
    const r = await fetch(`${BASE}/sessions/${sessionKey}/tasks/${taskId}/reopen`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao reabrir tarefa')
    return r.json()
  },

  async continueSession(sessionKey) {
    const r = await fetch(`${BASE}/sessions/${sessionKey}/continue`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao continuar sessão')
    return r.json()
  },

  async fetchAgents() {
    const r = await fetch(`${BASE}/agents`)
    if (!r.ok) throw new Error('Falha ao buscar agentes')
    return r.json()
  },

  async createAgent(agent) {
    const r = await fetch(`${BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    })
    if (r.status === 409) throw new Error('Já existe um agente com esse id')
    if (!r.ok) throw new Error('Falha ao criar agente')
    return r.json()
  },

  async updateAgent(id, agent) {
    const r = await fetch(`${BASE}/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    })
    if (!r.ok) throw new Error('Falha ao editar agente')
    return r.json()
  },

  async deleteAgent(id) {
    const r = await fetch(`${BASE}/agents/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('Falha ao remover agente')
    return r.json()
  },

  // -- Board (Fase 05-tarefas-board-jira, contrato em 05-ARQUITETO.md §2) --

  async fetchCards(projetoIds) {
    // Filtro opcional por lista de projeto_id — repetido como múltiplos
    // params (?projeto_id=a&projeto_id=b), igual ao contrato do backend
    // (`Query(default=None)` sobre `list[str]` em GET /api/cards).
    // Sem filtro (undefined/vazio) busca cards de todos os projetos.
    const params = new URLSearchParams()
    if (projetoIds && projetoIds.length) {
      for (const id of projetoIds) params.append('projeto_id', id)
    }
    const qs = params.toString()
    const r = await fetch(`${BASE}/cards${qs ? `?${qs}` : ''}`)
    if (!r.ok) throw new Error('Falha ao buscar cards')
    return r.json()
  },

  async createCard({ titulo, projeto_id, cliente_id, status, descricao }) {
    // Card cliente-only (feature Cliente/Projeto): o payload chega sem
    // `projeto_id`, só `cliente_id` — `JSON.stringify` descarta chaves
    // `undefined` sozinho, então não precisa de lógica condicional aqui;
    // o backend resolve projeto_id = cliente_id (CardStore.create ramo 3).
    const r = await fetch(`${BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, projeto_id, cliente_id, status, descricao }),
    })
    if (!r.ok) throw new Error('Falha ao criar card')
    return r.json()
  },

  async createSubcard(parentId, { titulo, status, descricao }) {
    const r = await fetch(`${BASE}/cards/${parentId}/subcards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, status, descricao }),
    })
    if (!r.ok) throw new Error('Falha ao criar subtarefa')
    return r.json()
  },

  async updateCard(cardId, { titulo, descricao, status }) {
    const r = await fetch(`${BASE}/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, descricao, status }),
    })
    if (!r.ok) throw new Error('Falha ao atualizar card')
    return r.json()
  },

  async deleteCard(cardId) {
    const r = await fetch(`${BASE}/cards/${cardId}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('Falha ao excluir card')
    return r.json()
  },

  async uploadCardImage(cardId, file) {
    // multipart/form-data — NÃO setar Content-Type manualmente, o browser
    // precisa gerar o boundary correto a partir do FormData.
    const formData = new FormData()
    formData.append('file', file)
    const r = await fetch(`${BASE}/cards/${cardId}/images`, {
      method: 'POST',
      body: formData,
    })
    if (!r.ok) throw new Error('Falha ao enviar imagem')
    return r.json()
  },

  async deleteCardImage(cardId, imageId) {
    const r = await fetch(`${BASE}/cards/${cardId}/images/${imageId}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('Falha ao remover imagem')
    return r.json()
  },

  async previewClearFinished(projetoId) {
    const r = await fetch(`${BASE}/cards/limpar-concluidos/preview?projeto_id=${encodeURIComponent(projetoId)}`)
    if (!r.ok) throw new Error('Falha ao buscar preview de limpeza')
    return r.json()
  },

  async clearFinished(projetoId) {
    const r = await fetch(`${BASE}/cards/limpar-concluidos?projeto_id=${encodeURIComponent(projetoId)}`, {
      method: 'POST',
    })
    if (!r.ok) throw new Error('Falha ao limpar concluídos')
    return r.json()
  },

  // -- Tarefas (visão global, Fase 05-tarefas-board-jira, Tarefa 27) --

  async fetchGlobalTasks() {
    // Agrega a mesma tabela `tasks` que fetchTasks(sessionKey) já usa, mas
    // sem escopo de sessão — cada item já vem com session_key/projeto_id/
    // agent_id/session_display_name resolvidos pelo backend (GET
    // /api/tasks/global, ver 05-TL.md Tarefa 11).
    const r = await fetch(`${BASE}/tasks/global`)
    if (!r.ok) throw new Error('Falha ao buscar tarefas globais')
    return r.json()
  },

  // -- Aparência (Milestone 1, plano Layout v2, 05-TL.md) --

  async fetchAppearance() {
    // Consumido pelo bootstrap síncrono-com-fetch em main.jsx ANTES do
    // primeiro render — layout_version/theme_mode precisam estar resolvidos
    // antes de montar <App/>, não depois. Timeout explícito (achado do QA,
    // Milestone 1): sem ele, uma requisição pendurada (rede instável via
    // Tailscale) nunca resolve nem rejeita e trava o boot indefinidamente —
    // o `.catch()` em main.jsx só cobre rejeição, não travamento.
    const r = await fetch(`${BASE}/settings/appearance`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error('Falha ao buscar configuração de aparência')
    return r.json()
  },

  async updateAppearance(partial) {
    // partial: { layout_version?, theme_mode? } — partial update, mesmo
    // contrato do backend (SettingsStore.update/AppearanceUpdateRequest).
    const r = await fetch(`${BASE}/settings/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    })
    if (!r.ok) throw new Error('Falha ao atualizar configuração de aparência')
    return r.json()
  },

  // -- End-of-chat notification (sound + Web Notification on the open tab) --

  async fetchNotificationSettings() {
    // Returns the 3 persisted columns (quiet_hours_enabled/start/end) plus
    // 2 fields DERIVED from the server's clock: server_utc_offset_minutes
    // (required — the window is defined in the server's timezone, and the
    // phone accessing via Tailscale might be in a different one) and
    // quiet_hours_active.
    const r = await fetch(`${BASE}/settings/notifications`)
    if (!r.ok) throw new Error('Falha ao buscar configuração de notificações')
    return r.json()
  },

  async updateNotificationSettings(partial) {
    // partial: { quiet_hours_enabled?, quiet_hours_start?, quiet_hours_end? }
    const r = await fetch(`${BASE}/settings/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(body.detail?.[0]?.msg || 'Falha ao salvar configuração de notificações')
    }
    return r.json()
  },

  // -- Pasta de projetos configurável --

  async fetchProjectsRoot() {
    const r = await fetch(`${BASE}/settings/projects-root`)
    if (!r.ok) throw new Error('Falha ao buscar pasta de projetos')
    return r.json()
  },

  async browseProjectsRootFolder() {
    const r = await fetch(`${BASE}/settings/projects-root/browse`, { method: 'POST' })
    if (!r.ok) throw new Error('Falha ao abrir seletor de pasta')
    return r.json()
  },

  async updateProjectsRoot(path) {
    const r = await fetch(`${BASE}/settings/projects-root`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects_root_path: path }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(body.detail || 'Falha ao salvar pasta de projetos')
    }
    return r.json()
  },

  // -- Attachments per project (filesystem-only backend, no sessions.db table) --

  async listAttachments(projectId) {
    // projectId may contain '/' (sub-project paths) — same convention as
    // terminateSession/fetchTasks above, don't encode it.
    const r = await fetch(`${BASE}/projects/${projectId}/attachments`)
    if (!r.ok) throw new Error('Falha ao buscar anexos')
    return r.json()
  },

  async uploadAttachments(projectId, files) {
    // multipart/form-data — NÃO setar Content-Type manualmente, mesmo
    // cuidado de uploadCardImage acima. Um append('files', file) por
    // arquivo, casando com `files: list[UploadFile] = File(...)` no backend.
    const formData = new FormData()
    for (const file of files) formData.append('files', file)
    const r = await fetch(`${BASE}/projects/${projectId}/attachments`, {
      method: 'POST',
      body: formData,
    })
    if (!r.ok) throw new Error('Falha ao enviar anexo(s)')
    return r.json()
  },

  async deleteAttachment(projectId, attachmentId) {
    const r = await fetch(`${BASE}/projects/${projectId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    })
    if (!r.ok) throw new Error('Falha ao remover anexo')
    return r.json()
  },

  async pasteToSession(sessionKey, text) {
    // sessionKey may contain '/' (sub-project paths) — same convention as
    // continueSession above, don't encode it.
    const r = await fetch(`${BASE}/sessions/${sessionKey}/paste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!r.ok) throw new Error('Falha ao colar no chat')
    return r.json()
  },
}

