import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { buildScope } from './boardScope.js'
import { card, COLUMNS, registry } from './boardFixtures.js'
import { useBoardData } from './useBoardData.js'

const attachment = (id, filename = `file-${id}.md`) => ({ id, card_id: 1, filename, size_bytes: 12, created_at: 1700000000 })
const CARDS = [card(1, 'Pessoal/tn-sandbox', { attachments: [attachment(5)] })]

async function setup() {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
  const scope = buildScope({ registry: registry(), workspaceKey: '', projectKey: '' })
  const view = renderHook(() => useBoardData({ scope }))
  await waitFor(() => expect(view.result.current.cardsLoaded).toBe(true))
  return view
}

// Runs a call that must fail INSIDE act, so the state it raised is rendered before the test reads it
// (an act() that rejects does not flush: `result.current` would still be the old render).
async function rejectionOf(actFn, call) {
  let caught = null
  await actFn(async () => {
    try {
      await call()
    } catch (error) {
      caught = error
    }
  })
  return caught
}
const attachmentsOf = (result) => result.current.cards.find((entry) => entry.id === 1).attachments.map((entry) => entry.id)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBoardData: card attachments', () => {
  it('uploads through the client and puts the new attachment on the card', async () => {
    const { result } = await setup()
    const file = new File(['x'], 'plan.md')
    vi.spyOn(api, 'uploadCardAttachment').mockResolvedValue(attachment(6, 'plan.md'))
    let returned
    await act(async () => { returned = await result.current.uploadAttachment(1, file) })
    expect(api.uploadCardAttachment).toHaveBeenCalledWith(1, file)
    expect(returned.id).toBe(6)
    expect(attachmentsOf(result)).toEqual([5, 6])
  })

  it('rethrows an upload failure and leaves no generic notice behind (the section tells it)', async () => {
    const { result } = await setup()
    const boom = new Error('Falha ao enviar anexo')
    vi.spyOn(api, 'uploadCardAttachment').mockRejectedValue(boom)
    await expect(rejectionOf(act, () => result.current.uploadAttachment(1, new File(['x'], 'a.md')))).resolves.toBe(boom)
    expect(result.current.mutationError).toBeNull()
    expect(attachmentsOf(result)).toEqual([5])
  })

  it('deletes through the client and takes the attachment off the card', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteCardAttachment').mockResolvedValue({ success: true })
    await act(async () => { await result.current.deleteAttachment(1, 5) })
    expect(api.deleteCardAttachment).toHaveBeenCalledWith(1, 5)
    expect(attachmentsOf(result)).toEqual([])
  })

  it('rethrows a delete failure, keeps the attachment and leaves no generic notice behind', async () => {
    const { result } = await setup()
    const boom = new Error('Falha ao remover anexo')
    vi.spyOn(api, 'deleteCardAttachment').mockRejectedValue(boom)
    await expect(rejectionOf(act, () => result.current.deleteAttachment(1, 5))).resolves.toBe(boom)
    expect(result.current.mutationError).toBeNull()
    expect(attachmentsOf(result)).toEqual([5])
  })
})
