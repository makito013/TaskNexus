import { describe, it, expect } from 'vitest'
import { buildCreatePayload, buildPatch, resolveCreateDefaults, cardErrorText, CARD_SAVE_FALLBACK } from './cardForm.js'
import { COLUMNS, registry } from './boardFixtures.js'

const index = registry()
const form = (extra = {}) => ({
  titulo: ' Novo ', descricao: '', status: 'a_fazer', tipo: '', prazo: '', prioridade: '', projectKey: 'Pessoal/tn-sandbox', ...extra,
})

describe('buildCreatePayload', () => {
  it('is always complete, trims the title, turns empty tipo/prazo/prioridade into null and keeps an empty description as the V2 does', () => {
    expect(buildCreatePayload(form())).toEqual({
      titulo: 'Novo', projeto_id: 'Pessoal/tn-sandbox', status: 'a_fazer', descricao: '', tipo: null, prazo: null, prioridade: null,
    })
  })
  it('keeps what was filled in', () => {
    const payload = buildCreatePayload(form({ descricao: 'd', tipo: 'bug', prazo: '2026-12-01', prioridade: 'alta' }))
    expect(payload).toMatchObject({ descricao: 'd', tipo: 'bug', prazo: '2026-12-01', prioridade: 'alta' })
  })
})

describe('buildPatch', () => {
  const original = { id: 1, projeto_id: 'Pessoal/tn-sandbox' }
  it('is empty when nothing was touched', () => {
    expect(buildPatch(form(), new Set(), original)).toEqual({})
  })
  it('carries only the touched keys, and an empty value is kept (it clears)', () => {
    expect(buildPatch(form({ titulo: ' Outro ', tipo: '' }), new Set(['titulo', 'tipo']), original)).toEqual({ titulo: 'Outro', tipo: '' })
  })
  it('does not send the place when it came back to the original', () => {
    expect(buildPatch(form(), new Set(['projeto']), original)).toEqual({})
  })
  it('sends the new place', () => {
    expect(buildPatch(form({ projectKey: 'Pessoal' }), new Set(['projeto']), original)).toEqual({ projeto_id: 'Pessoal' })
  })
})

describe('resolveCreateDefaults', () => {
  const base = { registry: index, columns: COLUMNS, columnSlug: 'em_andamento', workspaceKey: '', projectKey: '' }
  it('uses the project of the filter and the column that was clicked', () => {
    expect(resolveCreateDefaults({ ...base, workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' })).toEqual({ projectKey: 'Pessoal/tn-sandbox', status: 'em_andamento' })
  })
  it('falls back to the first column when the slug is unknown', () => {
    expect(resolveCreateDefaults({ ...base, columnSlug: 'nope' }).status).toBe('a_fazer')
  })
  it('without a project, uses the root of the filtered workspace', () => {
    expect(resolveCreateDefaults({ ...base, workspaceKey: 'podesubir' }).projectKey).toBe('podesubir')
  })
  it('the "Do workspace" refinement means the root of the workspace', () => {
    expect(resolveCreateDefaults({ ...base, workspaceKey: 'Pessoal', projectKey: '__workspace' }).projectKey).toBe('Pessoal')
  })
  it('with no filter, or outside every workspace, uses the root of the first active workspace', () => {
    expect(resolveCreateDefaults(base).projectKey).toBe('Pessoal')
    expect(resolveCreateDefaults({ ...base, workspaceKey: '__none' }).projectKey).toBe('Pessoal')
  })
  it('never lands in an archived project or workspace', () => {
    expect(resolveCreateDefaults({ ...base, workspaceKey: 'Pessoal', projectKey: 'Pessoal/old' }).projectKey).toBe('Pessoal')
    expect(resolveCreateDefaults({ ...base, workspaceKey: 'Velho' }).projectKey).toBe('Pessoal')
  })
  it('is null when there is no active workspace at all', () => {
    expect(resolveCreateDefaults({ ...base, registry: { ...index, workspaces: [] } })).toBeNull()
  })
})

describe('cardErrorText', () => {
  it('says the connection is down for a TypeError, never the browser words', () => {
    expect(cardErrorText(new TypeError('Failed to fetch'), CARD_SAVE_FALLBACK)).toBe('Sem conexão com o servidor. Tente de novo.')
  })
  it('uses the fixed fallback for anything else, never the message', () => {
    expect(cardErrorText(new Error('Falha ao atualizar card'), CARD_SAVE_FALLBACK)).toBe(CARD_SAVE_FALLBACK)
  })
  it('says the card is gone', () => {
    expect(cardErrorText(Object.assign(new Error('x'), { cardGone: true }), CARD_SAVE_FALLBACK)).toBe('Este card não existe mais.')
  })
})
