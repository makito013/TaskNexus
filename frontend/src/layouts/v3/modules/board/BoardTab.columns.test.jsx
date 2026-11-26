// The column management and the "Mover" select of the board, through the real drag context (the
// providers must mount, which a passthrough would hide) and the api by spy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import BoardTab from './BoardTab.jsx'
import { card, COLUMNS, registry } from './boardFixtures.js'

installDialogElementStub()

const PLACE = 'Pessoal/tn-sandbox'
const CARDS = [
  card(1, PLACE, { board_position: 1 }),
  card(2, PLACE, { board_position: 2 }),
  card(3, PLACE, { board_position: 3, status: 'feito' }),
]
const index = registry()

const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const titlesIn = (name) => within(column(name)).queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
const columnNames = () => screen.getAllByRole('group')
  .map((group) => group.getAttribute('aria-label'))
  .filter((label) => label.startsWith('Coluna '))
  .map((label) => label.replace('Coluna ', ''))

async function setup({ cards = CARDS, columns = COLUMNS } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  const view = render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
  await screen.findByRole('region', { name: 'Board' })
  await waitFor(() => expect(screen.queryAllByLabelText('Carregando cards')).toHaveLength(0))
  return view
}

const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `Mais ações da coluna ${name}` }))

beforeEach(() => {
  localStorage.clear()
  resetDialogElementStubState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the board with the real drag providers', () => {
  it('mounts the columns and the cards inside them, in order', async () => {
    await setup()
    expect(columnNames()).toEqual(['A fazer', 'Em andamento', 'Feito'])
    expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2'])
    expect(column('A fazer').querySelectorAll('li')).toHaveLength(2)
  })

  it('the header is the grip: it carries the press listeners, and the card list item does too', async () => {
    await setup()
    const header = column('A fazer').querySelector('header')
    expect(header.getAttribute('tabindex')).toBe('-1')
    expect(header.getAttribute('data-column-header')).toBe('a_fazer')
  })

  it('pressing the header and moving it past 6 px lifts the column (the header is the activator)', async () => {
    await setup()
    const header = column('Em andamento').querySelector('header')
    fireEvent.mouseDown(header, { button: 0, clientX: 100, clientY: 20 })
    // Under the distance nothing is lifted.
    fireEvent.mouseMove(document, { clientX: 103, clientY: 20 })
    expect(document.querySelector('.v3-board-overlay--column')).toBeNull()
    fireEvent.mouseMove(document, { clientX: 112, clientY: 20 })
    await waitFor(() => expect(document.querySelector('.v3-board-overlay--column')).toBeTruthy())
    expect(document.querySelector('.v3-board-overlay--column').textContent).toContain('Em andamento')
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('the same press on the column body lifts nothing: only the header is the grip', async () => {
    await setup()
    const body = column('Em andamento').querySelector('.v3-board-column__body')
    fireEvent.mouseDown(body, { button: 0, clientX: 100, clientY: 120 })
    fireEvent.mouseMove(document, { clientX: 130, clientY: 120 })
    expect(document.querySelector('.v3-board-overlay--column')).toBeNull()
    fireEvent.mouseUp(document)
  })

  it('names no second group inside a column and no dnd-kit description in English', async () => {
    await setup()
    expect(within(column('A fazer')).queryAllByRole('group')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('To pick up a draggable item')
  })

  it('offers "+ Nova coluna" after the columns', async () => {
    await setup()
    expect(screen.getByRole('button', { name: '+ Nova coluna' })).toBeTruthy()
  })
})

describe('creating a column', () => {
  it('the new column appears at the end and takes the focus on its header', async () => {
    vi.spyOn(api, 'createBoardColumn').mockResolvedValue({ slug: 'em_teste', label: 'Em teste', position: 4, is_done: false })
    await setup()
    fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { target: { value: 'Em teste' } })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { key: 'Enter' }) })
    expect(api.createBoardColumn).toHaveBeenCalledWith('Em teste')
    expect(columnNames()).toEqual(['A fazer', 'Em andamento', 'Feito', 'Em teste'])
    await waitFor(() => expect(document.activeElement).toBe(column('Em teste').querySelector('header')))
  })

  it('a refusal stays under the field, with the board untouched', async () => {
    vi.spyOn(api, 'createBoardColumn').mockRejectedValue(new Error('Já existe uma coluna com esse nome.'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain('Já existe uma coluna com esse nome.')
    expect(columnNames()).toEqual(['A fazer', 'Em andamento', 'Feito'])
  })
})

describe('renaming a column', () => {
  it('goes through the menu and a dialog, and the column shows the new name', async () => {
    vi.spyOn(api, 'updateBoardColumn').mockResolvedValue({ slug: 'a_fazer', label: 'Backlog', position: 1, is_done: false })
    await setup()
    openMenu('A fazer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Renomear coluna' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nome da coluna' }), { target: { value: 'Backlog' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' })) })
    expect(api.updateBoardColumn).toHaveBeenCalledWith('a_fazer', 'Backlog')
    expect(columnNames()).toEqual(['Backlog', 'Em andamento', 'Feito'])
    expect(screen.queryByRole('dialog', { name: 'Renomear coluna' })).toBeNull()
  })

  it('a refused name keeps the dialog open with the reason', async () => {
    vi.spyOn(api, 'updateBoardColumn').mockRejectedValue(new Error('Já existe uma coluna com esse nome.'))
    await setup()
    openMenu('A fazer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Renomear coluna' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nome da coluna' }), { target: { value: 'Feito' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' })) })
    expect(within(dialog).getByRole('alert').textContent).toContain('Já existe uma coluna com esse nome.')
    expect(columnNames()).toEqual(['A fazer', 'Em andamento', 'Feito'])
  })
})

describe('marking the done column', () => {
  it('moves the mark to the column chosen', async () => {
    vi.spyOn(api, 'setDoneColumn').mockResolvedValue(COLUMNS.map((entry) => ({ ...entry, is_done: entry.slug === 'em_andamento' })))
    await setup()
    openMenu('Em andamento')
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Marcar como concluída' })) })
    expect(api.setDoneColumn).toHaveBeenCalledWith('em_andamento')
    expect(within(column('Em andamento')).getByText('✓ Concluída')).toBeTruthy()
    expect(within(column('Feito')).queryByText('✓ Concluída')).toBeNull()
  })

  it('a failure is said in the banner, without an alert()', async () => {
    vi.spyOn(api, 'setDoneColumn').mockRejectedValue(new Error('x'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await setup()
    openMenu('Em andamento')
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Marcar como concluída' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui marcar a coluna como concluída.')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('the done column offers no second mark and no delete', async () => {
    await setup()
    openMenu('Feito')
    expect(screen.getByRole('menuitemradio', { name: 'Esta é a coluna de concluídos' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Excluir coluna' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('deleting a column', () => {
  it('asks, deletes and the column goes', async () => {
    vi.spyOn(api, 'deleteBoardColumn').mockResolvedValue({})
    await setup()
    openMenu('Em andamento')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Excluir coluna' })
    expect(dialog.textContent).toContain('Excluir a coluna Em andamento?')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' })) })
    expect(api.deleteBoardColumn).toHaveBeenCalledWith('em_andamento')
    expect(columnNames()).toEqual(['A fazer', 'Feito'])
  })

  it('a column with cards is refused by its reason and stays', async () => {
    vi.spyOn(api, 'deleteBoardColumn').mockRejectedValue(Object.assign(new Error('x'), { reason: 'coluna_com_cards', cards: 2 }))
    await setup()
    openMenu('A fazer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Excluir coluna' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' })) })
    expect(dialog.textContent).toContain('A coluna ainda tem cards.')
    expect(columnNames()).toEqual(['A fazer', 'Em andamento', 'Feito'])
  })

  it('the last column cannot even ask', async () => {
    await setup({ columns: [COLUMNS[0]], cards: [CARDS[0]] })
    openMenu('A fazer')
    expect(screen.getByRole('menuitem', { name: 'Excluir coluna' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('the "Mover" select', () => {
  const selectOf = (title) => screen.getByRole('combobox', { name: `Mover "${title}"` })

  it('is in the foot of every card, naming it, with the column it is in', async () => {
    await setup()
    expect(selectOf('Card 1').value).toBe('a_fazer')
    expect(selectOf('Card 2').value).toBe('a_fazer')
    expect(selectOf('Card 3').value).toBe('feito')
  })

  it('moves the card to the end of the column chosen, with a status change', async () => {
    vi.spyOn(api, 'updateCard').mockResolvedValue({ ...CARDS[0], status: 'em_andamento', board_position: 9 })
    await setup()
    await act(async () => { fireEvent.change(selectOf('Card 1'), { target: { value: 'em_andamento' } }) })
    expect(api.updateCard).toHaveBeenCalledWith(1, { status: 'em_andamento' })
    expect(titlesIn('Em andamento')).toEqual(['Card 1'])
    expect(titlesIn('A fazer')).toEqual(['Card 2'])
  })

  it('a failure leaves the card where it was and says so', async () => {
    vi.spyOn(api, 'updateCard').mockRejectedValue(new Error('Falha ao atualizar card'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await setup()
    await act(async () => { fireEvent.change(selectOf('Card 1'), { target: { value: 'feito' } }) })
    expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2'])
    expect(selectOf('Card 1').value).toBe('a_fazer')
    expect(screen.getByRole('alert').textContent).toContain('Não consegui mover o card. Ele voltou para onde estava.')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('works in a sorted view as well', async () => {
    localStorage.setItem('tasknexus.board.view', JSON.stringify({ sort: 'titulo' }))
    vi.spyOn(api, 'updateCard').mockResolvedValue({ ...CARDS[0], status: 'feito' })
    await setup()
    await act(async () => { fireEvent.change(selectOf('Card 1'), { target: { value: 'feito' } }) })
    expect(api.updateCard).toHaveBeenCalledWith(1, { status: 'feito' })
  })
})
