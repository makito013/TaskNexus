import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { buildScope } from './boardScope.js'
import { card, COLUMNS, registry } from './boardFixtures.js'
import { useBoardData } from './useBoardData.js'

const CARDS = [
  card(1, 'Pessoal/tn-sandbox', { board_position: 1 }),
  card(2, 'Pessoal/tn-sandbox', { board_position: 2, subcards: [card(21, 'Pessoal/tn-sandbox', { parent_id: 2 })] }),
  card(3, 'Pessoal/tn-sandbox', { board_position: 3, status: 'feito' }),
  card(4, 'Pessoal', { board_position: 4, status: 'feito' }),
]
const index = registry()

async function setup({ projectKey = '', workspaceKey = '' } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
  const scope = buildScope({ registry: index, workspaceKey, projectKey })
  const view = renderHook(() => useBoardData({ scope }))
  await waitFor(() => expect(view.result.current.cardsLoaded).toBe(true))
  return view
}

const failure = (message, extra = {}) => Object.assign(new Error(message), extra)
const ids = (result) => result.current.cards.map((entry) => entry.id)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBoardData: creating a card', () => {
  it('posts the payload as given and shows the card that landed inside the scope', async () => {
    const { result } = await setup()
    const created = card(50, 'Pessoal/tn-sandbox', { titulo: 'Novo' })
    vi.spyOn(api, 'createCard').mockResolvedValue(created)
    const payload = { titulo: 'Novo', projeto_id: 'Pessoal/tn-sandbox', status: 'a_fazer', descricao: null, tipo: null, prazo: null, prioridade: null }
    let returned
    await act(async () => { returned = await result.current.createCard(payload) })
    expect(api.createCard).toHaveBeenCalledWith(payload)
    expect(returned).toBe(created)
    expect(ids(result)).toContain(50)
  })

  it('a card created outside the project filter is not put on screen', async () => {
    const { result } = await setup({ projectKey: 'Pessoal/tn-sandbox' })
    vi.spyOn(api, 'createCard').mockResolvedValue(card(51, 'podesubir/ymci'))
    await act(async () => { await result.current.createCard({ titulo: 'x', projeto_id: 'podesubir/ymci' }) })
    expect(ids(result)).not.toContain(51)
  })

  it('a card created outside the workspace filter is not put on screen either', async () => {
    const { result } = await setup({ workspaceKey: 'Pessoal' })
    vi.spyOn(api, 'createCard').mockResolvedValue(card(52, 'podesubir/ymci'))
    await act(async () => { await result.current.createCard({ titulo: 'x', projeto_id: 'podesubir/ymci' }) })
    expect(ids(result)).not.toContain(52)
  })

  it('rethrows the failure and leaves no generic notice behind (the dialog tells it)', async () => {
    const { result } = await setup()
    const boom = failure('Falha ao criar card')
    vi.spyOn(api, 'createCard').mockRejectedValue(boom)
    await expect(act(() => result.current.createCard({ titulo: 'x' }))).rejects.toBe(boom)
    expect(result.current.mutationError).toBeNull()
  })
})

describe('useBoardData: saving a card', () => {
  it('sends only the keys it is given', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateCard').mockResolvedValue({ ...card(1, 'Pessoal/tn-sandbox'), titulo: 'Outro' })
    await act(async () => { await result.current.updateCard(1, { titulo: 'Outro' }) })
    expect(api.updateCard).toHaveBeenCalledWith(1, { titulo: 'Outro' })
    expect(result.current.cards.find((entry) => entry.id === 1).titulo).toBe('Outro')
  })

  it('a failure with the card still on the server is the plain error', async () => {
    const { result } = await setup()
    const boom = failure('Falha ao atualizar card')
    vi.spyOn(api, 'updateCard').mockRejectedValue(boom)
    await expect(act(() => result.current.updateCard(1, { titulo: 'x' }))).rejects.toBe(boom)
    expect(api.fetchCards).toHaveBeenLastCalledWith()
    expect(result.current.mutationError).toBeNull()
  })

  it('a failure with the card missing from an unfiltered read says the card is gone', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateCard').mockRejectedValue(failure('Falha ao atualizar card'))
    api.fetchCards.mockResolvedValue(CARDS.filter((entry) => entry.id !== 1))
    let caught
    await act(async () => { caught = await result.current.updateCard(1, { titulo: 'x' }).catch((error) => error) })
    expect(caught.cardGone).toBe(true)
  })

  it('a subcard that is still inside its parent is not gone', async () => {
    const { result } = await setup()
    const boom = failure('Falha ao atualizar card')
    vi.spyOn(api, 'updateCard').mockRejectedValue(boom)
    let caught
    await act(async () => { caught = await result.current.updateCard(21, { titulo: 'x' }).catch((error) => error) })
    expect(caught).toBe(boom)
    expect(caught.cardGone).toBeUndefined()
  })

  it('when the check cannot read either, the common error stands', async () => {
    const { result } = await setup()
    const boom = failure('Falha ao atualizar card')
    vi.spyOn(api, 'updateCard').mockRejectedValue(boom)
    api.fetchCards.mockRejectedValue(failure('down'))
    let caught
    await act(async () => { caught = await result.current.updateCard(1, { titulo: 'x' }).catch((error) => error) })
    expect(caught).toBe(boom)
  })

  it('does not even look for the card when the connection is down', async () => {
    const { result } = await setup()
    const down = new TypeError('Failed to fetch')
    vi.spyOn(api, 'updateCard').mockRejectedValue(down)
    const reads = api.fetchCards.mock.calls.length
    let caught
    await act(async () => { caught = await result.current.updateCard(1, { titulo: 'x' }).catch((error) => error) })
    expect(caught).toBe(down)
    expect(api.fetchCards.mock.calls.length).toBe(reads)
  })
})

describe('useBoardData: deleting a card', () => {
  it('removes the card with its subcards', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteCard').mockResolvedValue({ subcards_afetados: 1 })
    await act(async () => { await result.current.deleteCard(2) })
    expect(api.deleteCard).toHaveBeenCalledWith(2)
    expect(ids(result)).not.toContain(2)
  })

  it('tells a missing card apart from a plain failure', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteCard').mockRejectedValue(failure('Falha ao excluir card'))
    api.fetchCards.mockResolvedValue(CARDS.filter((entry) => entry.id !== 1))
    let caught
    await act(async () => { caught = await result.current.deleteCard(1).catch((error) => error) })
    expect(caught.cardGone).toBe(true)
    expect(result.current.mutationError).toBeNull()
  })
})

describe('useBoardData: clearing the finished cards', () => {
  it('previews by the exact key and keeps only the counts', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 2, imagens: 3, imagens_com_falha: 9 })
    let preview
    await act(async () => { preview = await result.current.previewClear('Pessoal/tn-sandbox') })
    expect(api.previewClearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
    expect(preview).toEqual({ cards: 2, imagens: 3 })
  })

  it('executes by the exact key, drops the failed images count and takes only that key out of the done column', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'clearFinished').mockResolvedValue({ cards: 1, imagens: 0, imagens_com_falha: 4 })
    let outcome
    await act(async () => { outcome = await result.current.executeClear('Pessoal/tn-sandbox') })
    expect(api.clearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
    expect(outcome).toEqual({ cards: 1 })
    expect(ids(result)).not.toContain(3)
    expect(ids(result)).toContain(4)
  })

  it('lets a failed read or run reach the dialog without a generic notice', async () => {
    const { result } = await setup()
    const boom = failure('Falha ao limpar concluídos')
    vi.spyOn(api, 'clearFinished').mockRejectedValue(boom)
    vi.spyOn(api, 'previewClearFinished').mockRejectedValue(boom)
    await expect(act(() => result.current.executeClear('Pessoal'))).rejects.toBe(boom)
    await expect(act(() => result.current.previewClear('Pessoal'))).rejects.toBe(boom)
    expect(result.current.mutationError).toBeNull()
  })
})

describe('useBoardData: images and questions', () => {
  it('uploads and deletes an image on the card', async () => {
    const { result } = await setup()
    const image = { id: 7, card_id: 1, filename: 'a.png', url: '/board_uploads/1/a.png', mime_type: 'image/png', size_bytes: 3, criado_em: 1 }
    vi.spyOn(api, 'uploadCardImage').mockResolvedValue(image)
    vi.spyOn(api, 'deleteCardImage').mockResolvedValue({})
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await act(async () => { await result.current.uploadImage(1, file) })
    expect(api.uploadCardImage).toHaveBeenCalledWith(1, file)
    expect(result.current.fetchedCards.find((entry) => entry.id === 1).imagens).toEqual([image])
    await act(async () => { await result.current.deleteImage(1, 7) })
    expect(api.deleteCardImage).toHaveBeenCalledWith(1, 7)
    expect(result.current.fetchedCards.find((entry) => entry.id === 1).imagens).toEqual([])
  })

  it('answers and deletes a question; failures reach the caller without a generic notice', async () => {
    const withQuestion = [
      { ...CARDS[0], questions: [{ id: 5, card_id: 1, question: 'Q?', answer: null, asked_by: 'agente:x', created_at: 1, answered_at: null }] },
      ...CARDS.slice(1),
    ]
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockResolvedValue(withQuestion)
    const view = renderHook(() => useBoardData({ scope: buildScope({ registry: index }) }))
    await waitFor(() => expect(view.result.current.cardsLoaded).toBe(true))
    vi.spyOn(api, 'answerCardQuestion').mockResolvedValue({ id: 5, card_id: 1, question: 'Q?', answer: 'sim', asked_by: 'agente:x', created_at: 1, answered_at: 2 })
    await act(async () => { await view.result.current.answerQuestion(1, 5, 'sim') })
    expect(api.answerCardQuestion).toHaveBeenCalledWith(1, 5, 'sim')
    expect(view.result.current.fetchedCards[0].questions[0].answer).toBe('sim')

    const boom = failure('Falha ao remover pergunta')
    vi.spyOn(api, 'deleteCardQuestion').mockRejectedValue(boom)
    await expect(act(() => view.result.current.deleteQuestion(1, 5))).rejects.toBe(boom)
    expect(view.result.current.mutationError).toBeNull()
    api.deleteCardQuestion.mockResolvedValue({})
    await act(async () => { await view.result.current.deleteQuestion(1, 5) })
    expect(view.result.current.fetchedCards[0].questions).toEqual([])
  })
})
