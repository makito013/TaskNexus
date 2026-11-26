// Pure rules of the card dialog: what is sent to create or to change a card, which place a new card
// opens in, and which words a failure gets. No React, no I/O.
import { NO_CONNECTION_TEXT } from './columnErrors.js'
import { DO_WORKSPACE } from './boardScope.js'
import { listDestinations } from './destinations.js'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'

export const CARD_SAVE_FALLBACK = 'Não consegui salvar. Seus dados continuam aqui; tente de novo.'
export const CARD_GONE_TEXT = 'Este card não existe mais.'

// The words of a failed card request. The browser's English ("Failed to fetch") and the client's own
// message are never shown: a lost connection is told as such, a missing card as such, the rest by
// the fixed sentence of the action.
export function cardErrorText(error, fallback) {
  if (error && error.cardGone) return CARD_GONE_TEXT
  if (error instanceof TypeError) return NO_CONNECTION_TEXT
  return fallback
}

const orNull = (value) => (value === '' || value == null ? null : value)

// Creating sends everything: an empty tipo/prazo/prioridade becomes null (an empty tipo is a 422 on this route);
// an empty description stays '' as the V2 sends it.
export function buildCreatePayload(form) {
  return {
    titulo: form.titulo.trim(),
    projeto_id: form.projectKey,
    status: form.status,
    descricao: form.descricao ?? '',
    tipo: orNull(form.tipo),
    prazo: orNull(form.prazo),
    prioridade: orNull(form.prioridade),
  }
}

// Saving sends only what the person touched ({} = nothing to send). An empty value is kept on purpose:
// it is the "clear this field" sentinel of the PATCH. The place goes only when it differs from the card's own.
export function buildPatch(form, dirty, card) {
  const patch = {}
  if (dirty.has('titulo')) patch.titulo = form.titulo.trim()
  if (dirty.has('descricao')) patch.descricao = form.descricao
  if (dirty.has('status')) patch.status = form.status
  if (dirty.has('tipo')) patch.tipo = form.tipo
  if (dirty.has('prazo')) patch.prazo = form.prazo
  if (dirty.has('prioridade')) patch.prioridade = form.prioridade
  if (dirty.has('projeto') && form.projectKey && form.projectKey !== card.projeto_id) patch.projeto_id = form.projectKey
  return patch
}

// Where a new card opens: the project of the filter, else the root of the filtered workspace, else (no
// filter, or "Sem workspace") the root of the first active workspace, as the V2 does. Never an archived
// place and never a stray bucket; null when no active workspace exists (creating is then unavailable).
export function resolveCreateDefaults({ registry, workspaceKey = '', projectKey = '', columnSlug = null, columns = [] }) {
  const groups = listDestinations(registry)
  if (groups.length === 0) return null
  const allowed = new Set(groups.flatMap((group) => group.projects.map((project) => project.key)))
  const rootOf = (key) => groups.find((group) => group.workspaceKey === key)?.projects[0].key ?? null

  let chosen = null
  if (projectKey && projectKey !== DO_WORKSPACE && allowed.has(projectKey)) chosen = projectKey
  if (!chosen && workspaceKey && workspaceKey !== NO_WORKSPACE_VALUE) chosen = rootOf(workspaceKey)
  if (!chosen) chosen = groups[0].projects[0].key

  const status = columns.some((column) => column.slug === columnSlug) ? columnSlug : (columns[0]?.slug ?? 'a_fazer')
  return { projectKey: chosen, status }
}
