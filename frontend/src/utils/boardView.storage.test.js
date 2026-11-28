import { describe, it, expect, vi } from 'vitest'
import { BOARD_VIEW_STORAGE_KEY, DEFAULT_BOARD_VIEW, readBoardView, writeBoardView } from './boardView.js'

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => { data.set(key, String(value)) }),
    data,
  }
}

describe('readBoardView', () => {
  it('uses the V2 key', () => {
    expect(BOARD_VIEW_STORAGE_KEY).toBe('tasknexus.board.view')
  })

  it('returns the defaults for an empty storage', () => {
    expect(readBoardView(fakeStorage())).toEqual(DEFAULT_BOARD_VIEW)
  })

  it('restores the known string fields', () => {
    const storage = fakeStorage({
      [BOARD_VIEW_STORAGE_KEY]: JSON.stringify({ prioridade: 'alta', tipo: 'bug', prazo: 'atrasado', sort: 'titulo' }),
    })
    expect(readBoardView(storage)).toEqual({ prioridade: 'alta', tipo: 'bug', prazo: 'atrasado', sort: 'titulo' })
  })

  it('drops unknown keys and non-string values', () => {
    const storage = fakeStorage({
      [BOARD_VIEW_STORAGE_KEY]: JSON.stringify({ prioridade: 3, tipo: 'bug', evil: 'x', __proto__: { polluted: true } }),
    })
    const view = readBoardView(storage)
    expect(view).toEqual({ ...DEFAULT_BOARD_VIEW, tipo: 'bug' })
    expect('evil' in view).toBe(false)
  })

  it.each([['not json'], ['null'], ['42'], ['"text"'], ['[1,2]']])('survives the stored value %s', (raw) => {
    expect(readBoardView(fakeStorage({ [BOARD_VIEW_STORAGE_KEY]: raw }))).toEqual(DEFAULT_BOARD_VIEW)
  })

  it('never throws when the storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') } }
    expect(readBoardView(storage)).toEqual(DEFAULT_BOARD_VIEW)
  })

  it('never throws when there is no storage at all', () => {
    expect(readBoardView(null)).toEqual(DEFAULT_BOARD_VIEW)
  })

  it('returns a fresh object, not the frozen default', () => {
    const view = readBoardView(fakeStorage())
    expect(Object.isFrozen(view)).toBe(false)
    expect(view).not.toBe(DEFAULT_BOARD_VIEW)
  })
})

describe('writeBoardView', () => {
  it('writes only the known keys', () => {
    const storage = fakeStorage()
    writeBoardView({ prioridade: 'alta', tipo: '', prazo: '', sort: 'prazo', sneaky: 'x' }, storage)
    expect(JSON.parse(storage.data.get(BOARD_VIEW_STORAGE_KEY))).toEqual({
      prioridade: 'alta', tipo: '', prazo: '', sort: 'prazo',
    })
  })

  it('fills missing or non-string fields with the defaults', () => {
    const storage = fakeStorage()
    writeBoardView({ prioridade: 7 }, storage)
    expect(JSON.parse(storage.data.get(BOARD_VIEW_STORAGE_KEY))).toEqual(DEFAULT_BOARD_VIEW)
  })

  it('round-trips with readBoardView', () => {
    const storage = fakeStorage()
    const view = { prioridade: 'media', tipo: 'hotfix', prazo: 'com_prazo', sort: 'criado_em' }
    writeBoardView(view, storage)
    expect(readBoardView(storage)).toEqual(view)
  })

  it('never throws when the storage throws', () => {
    const storage = { setItem: () => { throw new Error('quota') } }
    expect(() => writeBoardView(DEFAULT_BOARD_VIEW, storage)).not.toThrow()
  })

  it('never throws without a storage', () => {
    expect(() => writeBoardView(DEFAULT_BOARD_VIEW, null)).not.toThrow()
  })
})

describe('readBoardView: values this build does not know', () => {
  it.each([
    ['prioridade', 'zzz'], ['tipo', 'epic'], ['prazo', 'amanha'], ['sort', 'xyz'],
  ])('puts a stale %s back to the default', (key, value) => {
    const storage = fakeStorage({ [BOARD_VIEW_STORAGE_KEY]: JSON.stringify({ prioridade: 'alta', [key]: value }) })
    const view = readBoardView(storage)
    expect(view[key]).toBe(DEFAULT_BOARD_VIEW[key])
    if (key !== 'prioridade') expect(view.prioridade).toBe('alta')
  })

  it('keeps every value the selects can produce', () => {
    const all = { prioridade: '__none__', tipo: 'historia', prazo: 'sem_prazo', sort: 'atualizado_em' }
    expect(readBoardView(fakeStorage({ [BOARD_VIEW_STORAGE_KEY]: JSON.stringify(all) }))).toEqual(all)
  })
})
