import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import BoardCardFace from './BoardCardFace.jsx'
import BoardTab from './BoardTab.jsx'
import { CARDS, COLUMNS, card, registry } from './boardFixtures.js'

installDialogElementStub()

const index = registry()
const TODAY = new Date(2026, 10, 26)

describe('BoardCardFace: opening the card', () => {
  const face = (props = {}) => render(
    <BoardCardFace card={card(5, 'Pessoal/tn-sandbox', { titulo: 'Abrir' })} registry={index} doneSlug="feito" today={TODAY} {...props} />,
  )

  it('the title is a button once the face can open the card, and a press on it opens it', () => {
    const onOpen = vi.fn()
    face({ onOpen })
    const title = screen.getByRole('button', { name: 'Abrir' })
    fireEvent.click(title)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), title)
  })

  it('a press anywhere on the face opens it', () => {
    const onOpen = vi.fn()
    const { container } = face({ onOpen })
    fireEvent.click(container.querySelector('.v3-board-card__foot'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a select, a link and a [data-card-control] do not open it; neither does the copy button', () => {
    const onOpen = vi.fn()
    const { container } = face({ onOpen, moveSelect: <span data-card-control><select aria-label="Mover"><option>a</option></select></span> })
    fireEvent.click(screen.getByLabelText('Mover'))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número do card 5' }))
    const link = document.createElement('a')
    link.href = '#x'
    container.querySelector('.v3-board-card__foot').appendChild(link)
    fireEvent.click(link)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a click right after a drop belongs to the drag and opens nothing', () => {
    const onOpen = vi.fn()
    face({ onOpen, isRecentDrop: () => true })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('without a handler the title stays plain text', () => {
    face()
    expect(screen.queryByRole('button', { name: 'Abrir' })).toBeNull()
  })
})

function setup(props = {}, { cards = CARDS, columns = COLUMNS } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  const element = (extra = {}) => (
    <ToastHost><BoardTab registry={index} workspaceKey="" showArchived={false} {...props} {...extra} /></ToastHost>
  )
  const view = render(element())
  return { ...view, rerenderWith: (extra) => view.rerender(element(extra)) }
}
const loaded = async () => { await screen.findByRole('region', { name: 'Board' }); await screen.findAllByText(/^Card /) }
const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const dialog = () => screen.getByRole('dialog')
const field = (name) => within(dialog()).getByLabelText(name)
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  resetDialogElementStubState()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('BoardTab: creating a card', () => {
  it('"+ Adicionar card" of a column opens the dialog on that column with the first active workspace as the place', async () => {
    setup()
    await loaded()
    fireEvent.click(within(column('Em andamento')).getByRole('button', { name: 'Adicionar card na coluna Em andamento' }))
    expect(dialog().textContent).toContain('Novo card')
    expect(field('Status').value).toBe('em_andamento')
    expect(field('Projeto').value).toBe('Pessoal')
  })

  it('with a project refined it opens on that project', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    fireEvent.click(within(column('A fazer')).getByRole('button', { name: 'Adicionar card na coluna A fazer' }))
    expect(field('Projeto').value).toBe('Pessoal/tn-sandbox')
  })

  it('creates with the complete payload, shows the card in its column and says where it went, then gives the focus back to the button', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    vi.spyOn(api, 'createCard').mockResolvedValue(card(90, 'Pessoal', { titulo: 'Criado agora', status: 'em_andamento' }))
    const add = within(column('Em andamento')).getByRole('button', { name: 'Adicionar card na coluna Em andamento' })
    add.focus()
    fireEvent.click(add)
    fireEvent.change(field('Título'), { target: { value: 'Criado agora' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Criar card' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.createCard).toHaveBeenCalledWith({
      titulo: 'Criado agora', projeto_id: 'Pessoal', status: 'em_andamento', descricao: '', tipo: null, prazo: null, prioridade: null,
    })
    expect(within(column('Em andamento')).getByText('Criado agora')).toBeTruthy()
    expect(await screen.findByText('Card criado em Do workspace Pessoal.')).toBeTruthy()
    expect(document.activeElement).toBe(add)
  })

  it('a card created outside the filter is not drawn, and the toast says where it is', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    vi.spyOn(api, 'createCard').mockResolvedValue(card(91, 'podesubir/ymci', { titulo: 'Em outro lugar' }))
    fireEvent.click(within(column('A fazer')).getByRole('button', { name: 'Adicionar card na coluna A fazer' }))
    fireEvent.change(field('Título'), { target: { value: 'Em outro lugar' } })
    fireEvent.change(field('Workspace'), { target: { value: String([...field('Workspace').options].findIndex((option) => option.textContent === 'podesubir')) } })
    fireEvent.change(field('Projeto'), { target: { value: 'podesubir/ymci' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Criar card' }))
    await screen.findByText('Card criado em ymci (podesubir).')
    expect(screen.queryByText('Em outro lugar')).toBeNull()
  })

  it('with no active workspace the button is unavailable and says why', async () => {
    const empty = buildRegistryIndex({ seeded: null, workspaces: [] })
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    render(<ToastHost><BoardTab registry={empty} workspaceKey="" showArchived={false} /></ToastHost>)
    await screen.findByRole('region', { name: 'Board' })
    const add = within(column('A fazer')).getByRole('button', { name: 'Adicionar card na coluna A fazer' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(add)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('BoardTab: opening and editing a card', () => {
  const open = async (title) => {
    const button = await screen.findByRole('button', { name: title })
    fireEvent.click(button)
    return button
  }

  it('opens the card of the face, and closing returns the focus to its title', async () => {
    setup()
    await loaded()
    const trigger = await open('Card 1')
    expect(dialog().textContent).toContain('Card 1')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('editing only the title sends a PATCH with only the title', async () => {
    setup()
    await loaded()
    await open('Card 1')
    vi.spyOn(api, 'updateCard').mockResolvedValue({ ...card(1, 'Pessoal/tn-sandbox'), titulo: 'Renomeado' })
    fireEvent.change(field('Título'), { target: { value: 'Renomeado' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.updateCard).toHaveBeenCalledTimes(1)
    expect(api.updateCard).toHaveBeenCalledWith(1, { titulo: 'Renomeado' })
    expect(await screen.findByText('Renomeado')).toBeTruthy()
  })

  it('saving without a change sends no request', async () => {
    setup()
    await loaded()
    await open('Card 1')
    vi.spyOn(api, 'updateCard')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.updateCard).not.toHaveBeenCalled()
  })

  it('moving a card of a stray bucket to a registered project sends only the place', async () => {
    setup()
    await loaded()
    await open('Card 4')
    vi.spyOn(api, 'updateCard').mockResolvedValue(card(4, 'Pessoal/tn-sandbox'))
    fireEvent.change(field('Workspace'), { target: { value: String([...field('Workspace').options].findIndex((option) => option.textContent === 'Pessoal')) } })
    fireEvent.change(field('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.updateCard).toHaveBeenCalledWith(4, { projeto_id: 'Pessoal/tn-sandbox' })
  })

  it('a card moved out of the list does not close or change the dialog while it is open', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    await open('Card 1')
    fireEvent.change(field('Título'), { target: { value: 'Meu texto' } })
    const before = api.fetchCards.mock.calls.length
    // the next poll no longer brings the card at all (moved elsewhere by someone else)
    api.fetchCards.mockResolvedValue(CARDS.filter((entry) => entry.id !== 1))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(api.fetchCards.mock.calls.length).toBeGreaterThan(before))
    // the poll was applied: the board behind the dialog lost the card
    await waitFor(() => expect(document.querySelectorAll('[data-card-open="1"]').length).toBe(0))
    expect(dialog().textContent).toContain('Card 1')
    expect(field('Título').value).toBe('Meu texto')
    expect(within(dialog()).getByRole('button', { name: 'Salvar' })).toBeTruthy()
  })

  it('a card that is gone from the server says so, in the dialog (C7)', async () => {
    setup()
    await loaded()
    await open('Card 1')
    vi.spyOn(api, 'updateCard').mockRejectedValue(new Error('Falha ao atualizar card'))
    api.fetchCards.mockResolvedValue(CARDS.filter((entry) => entry.id !== 1))
    fireEvent.change(field('Título'), { target: { value: 'x' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('Este card não existe mais.')
  })

  it('a failed save keeps the dialog, the typing and tells it in words; a second press goes through', async () => {
    setup()
    await loaded()
    await open('Card 1')
    const gate = deferred()
    vi.spyOn(api, 'updateCard').mockReturnValueOnce(gate.promise).mockResolvedValue({ ...card(1, 'Pessoal/tn-sandbox'), titulo: 'ok' })
    fireEvent.change(field('Título'), { target: { value: 'ok' } })
    const save = within(dialog()).getByRole('button', { name: 'Salvar' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(api.updateCard).toHaveBeenCalledTimes(1)
    await act(async () => { gate.reject(new TypeError('Failed to fetch')) })
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Sem conexão com o servidor. Tente de novo.')
    expect(field('Título').value).toBe('ok')
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.updateCard).toHaveBeenCalledTimes(2)
  })

  it('deleting a card with no subtasks removes it and the focus falls back to the board heading', async () => {
    setup()
    await loaded()
    await open('Card 1')
    vi.spyOn(api, 'deleteCard').mockResolvedValue({ subcards_afetados: 0 })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Excluir card' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.deleteCard).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('button', { name: 'Card 1' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Board', level: 2 }))
  })

  it('deleting a card with subtasks asks first', async () => {
    const withSubs = [card(1, 'Pessoal/tn-sandbox', { subcards: [card(11, 'Pessoal/tn-sandbox', { parent_id: 1 })] })]
    setup({}, { cards: withSubs })
    await loaded()
    await open('Card 1')
    vi.spyOn(api, 'deleteCard').mockResolvedValue({ subcards_afetados: 1 })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Excluir card' }))
    expect(api.deleteCard).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('dialog', { name: 'Excluir card' })
    expect(confirm.textContent).toContain('a 1 subtarefa')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(api.deleteCard).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('BoardTab: "Limpar concluídos"', () => {
  const button = () => screen.getByRole('button', { name: 'Limpar concluídos' })

  it('is unavailable with no workspace chosen, with the hint beside it', async () => {
    setup()
    await loaded()
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Escolha um projeto ou "Do workspace".')).toBeTruthy()
    fireEvent.click(button())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('with a project chosen previews, asks and runs for that exact key, then says how many went', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 2, imagens: 0, imagens_com_falha: 0 })
    vi.spyOn(api, 'clearFinished').mockResolvedValue({ cards: 2, imagens: 0, imagens_com_falha: 1 })
    button().focus()
    fireEvent.click(button())
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir 2 cards' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.previewClearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
    expect(api.clearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
    expect(await screen.findByText('2 cards excluídos.')).toBeTruthy()
    expect(document.activeElement).toBe(button())
  })

  it('in a workspace without a project the target is the workspace root and the dialog names it', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 1, imagens: 0 })
    fireEvent.click(button())
    await screen.findByRole('button', { name: 'Excluir 1 card' })
    expect(api.previewClearFinished).toHaveBeenCalledWith('Pessoal')
    expect(dialog().textContent).toContain('Do workspace Pessoal')
  })

  it('a refused run keeps the dialog and says it', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 1, imagens: 0 })
    vi.spyOn(api, 'clearFinished').mockRejectedValue(new Error('Falha ao limpar concluídos'))
    fireEvent.click(button())
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir 1 card' }))
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('Não consegui limpar os concluídos.')
    expect(screen.queryByText(/excluídos\./)).toBeNull()
  })
})
