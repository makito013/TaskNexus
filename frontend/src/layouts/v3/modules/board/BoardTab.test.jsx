import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { BOARD_VIEW_STORAGE_KEY } from '../../../../utils/boardView.js'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import BoardTab from './BoardTab.jsx'
import { CARDS, COLUMNS, card, registry } from './boardFixtures.js'

const index = registry()

function setup(props = {}, { cards = CARDS, columns = COLUMNS } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  const view = render(<BoardTab registry={index} workspaceKey="" showArchived={false} {...props} />)
  return {
    ...view,
    rerenderWith: (next) => view.rerender(<BoardTab registry={index} workspaceKey="" showArchived={false} {...props} {...next} />),
  }
}

const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const titlesIn = (name) => within(column(name)).queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
const select = (name) => screen.getByRole('combobox', { name })
const loaded = () => screen.findByRole('region', { name: 'Board' })

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('BoardTab: states', () => {
  it('shows still placeholders and a busy scroller while the columns load', async () => {
    let resolve
    vi.spyOn(api, 'fetchBoardColumns').mockReturnValue(new Promise((done) => { resolve = done }))
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    const { container } = render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    await act(async () => { resolve(COLUMNS) })
    await loaded()
  })

  it('shows the columns in order, the done one marked in words, with the count of its cards', async () => {
    setup()
    await loaded()
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')).filter((label) => label.startsWith('Coluna ')))
      .toEqual(['Coluna A fazer', 'Coluna Em andamento', 'Coluna Feito'])
    expect(within(column('Feito')).getByText('✓ Concluída')).toBeTruthy()
    expect(within(column('A fazer')).queryByText('✓ Concluída')).toBeNull()
    await waitFor(() => expect(within(column('Feito')).getByLabelText('1 cards')).toBeTruthy())
  })

  it('shows "…" for the count and no cards until the cards arrive', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockReturnValue(new Promise(() => {}))
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await loaded()
    expect(within(column('A fazer')).getByLabelText('Carregando cards').textContent).toBe('(…)')
    expect(screen.queryByText('Nenhum card aqui.')).toBeNull()
  })

  it('an empty column says so', async () => {
    setup({}, { cards: [] })
    await loaded()
    await waitFor(() => expect(within(column('A fazer')).getByText('Nenhum card aqui.')).toBeTruthy())
  })

  it('a board with no columns says so, without a button that does nothing', async () => {
    setup({}, { columns: [] })
    expect(await screen.findByText('O board ainda não tem colunas.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('failing to read the columns shows the error and "Tentar de novo" reads again', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    vi.spyOn(api, 'fetchBoardColumns').mockRejectedValueOnce(new Error('down')).mockResolvedValue(COLUMNS)
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui carregar o board.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    await loaded()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failing poll with data on screen shows the quiet chip and keeps the cards', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
      const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValueOnce(CARDS)
      render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.queryByText('Sem atualizar agora')).toBeNull()
      fetchCards.mockRejectedValueOnce(new Error('500'))
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.getByRole('status').textContent).toBe('Sem atualizar agora')
      expect(titlesIn('A fazer')).toContain('Card 1')
      fetchCards.mockResolvedValueOnce(CARDS)
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.queryByText('Sem atualizar agora')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BoardTab: scope of the header', () => {
  it('all workspaces hides the archived places and shows the strays', async () => {
    setup()
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5', 'Card 10']))
    expect(titlesIn('Feito')).toEqual(['Card 6'])
  })

  it('"Mostrar arquivados" brings the archived cards back', async () => {
    setup({ showArchived: true })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toContain('Card 7'))
    expect(titlesIn('A fazer')).toEqual(expect.arrayContaining(['Card 8', 'Card 9']))
  })

  it('a workspace shows its own cards, and the count follows', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3']))
    expect(within(column('A fazer')).getByLabelText('3 cards')).toBeTruthy()
    expect(titlesIn('Feito')).toEqual([])
  })

  it('"Sem workspace" shows the cards that live outside every workspace', async () => {
    setup({ workspaceKey: NO_WORKSPACE_VALUE })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 4', 'Card 5']))
  })

  it('a card of a stray bucket is reachable through the "Sem workspace" filter (CA06)', async () => {
    setup({ workspaceKey: NO_WORKSPACE_VALUE }, { cards: [card(40, 'NewCo/x')] })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 40']))
    expect(screen.getByText('NewCo/x')).toBeTruthy()
  })

  it('the project select is disabled without a real workspace and lists the projects with one', async () => {
    const { rerenderWith } = setup()
    await loaded()
    expect(select('Projeto').disabled).toBe(true)
    rerenderWith({ workspaceKey: 'Pessoal' })
    expect(select('Projeto').disabled).toBe(false)
    expect(within(select('Projeto')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Todos os projetos', 'tn-sandbox', 'silent-a', 'Do workspace'])
  })

  it('choosing a project narrows the cards and asks the server for that exact key', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith(['Pessoal/tn-sandbox']))
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1']))
    // the project is the filter: its chip is not repeated on every card
    expect(within(column('A fazer')).queryByText('tn-sandbox')).toBeNull()
  })

  it('"Do workspace" shows only the workspace root', async () => {
    setup({ workspaceKey: 'Pessoal' })
    await loaded()
    fireEvent.change(select('Projeto'), { target: { value: '__workspace' } })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith(['Pessoal']))
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 2']))
  })

  it('changing the workspace drops the project in the same render but keeps the other filters (K8)', async () => {
    const { rerenderWith } = setup({ workspaceKey: 'Pessoal' })
    await loaded()
    fireEvent.change(select('Prioridade'), { target: { value: 'alta' } })
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    expect(select('Projeto').value).toBe('Pessoal/tn-sandbox')
    rerenderWith({ workspaceKey: 'podesubir' })
    expect(select('Projeto').value).toBe('')
    expect(select('Prioridade').value).toBe('alta')
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith([]))
  })
})

describe('BoardTab: filters and sorting', () => {
  const rich = [
    card(1, 'Pessoal/tn-sandbox', { prioridade: 'alta', titulo: 'Beta', tipo: 'bug', prazo: '2020-01-01' }),
    card(2, 'Pessoal/tn-sandbox', { prioridade: 'baixa', titulo: 'Alfa', criado_em: 5 }),
    card(3, 'Pessoal/tn-sandbox', { prioridade: null, titulo: 'Gama', prazo: '2099-01-01' }),
    card(4, 'Pessoal/tn-sandbox', { titulo: 'Atrasado feito', status: 'feito', prazo: '2020-01-01' }),
  ]

  it('filters by priority, type and due date and counts after the filter', async () => {
    setup({}, { cards: rich })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))
    fireEvent.change(select('Prioridade'), { target: { value: 'alta' } })
    expect(titlesIn('A fazer')).toEqual(['Beta'])
    expect(within(column('A fazer')).getByLabelText('1 cards')).toBeTruthy()
    fireEvent.change(select('Prioridade'), { target: { value: '' } })
    fireEvent.change(select('Tipo'), { target: { value: '__none__' } })
    expect(titlesIn('A fazer')).toEqual(['Alfa', 'Gama'])
    fireEvent.change(select('Tipo'), { target: { value: '' } })
    fireEvent.change(select('Prazo'), { target: { value: 'atrasado' } })
    // overdue only counts outside the done column
    expect(titlesIn('A fazer')).toEqual(['Beta'])
    expect(titlesIn('Feito')).toEqual([])
  })

  it('sorts inside the columns and shows the hint about dragging', async () => {
    setup({}, { cards: rich })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))
    expect(screen.queryByText(/arrastar muda só a coluna/)).toBeNull()
    fireEvent.change(select('Ordenar'), { target: { value: 'titulo' } })
    expect(titlesIn('A fazer')).toEqual(['Alfa', 'Beta', 'Gama'])
    expect(screen.getByText('Com ordenação, arrastar muda só a coluna do card.')).toBeTruthy()
    fireEvent.change(select('Ordenar'), { target: { value: 'prioridade' } })
    expect(titlesIn('A fazer')).toEqual(['Beta', 'Alfa', 'Gama'])
  })

  it('the selects carry the V3 labels', async () => {
    setup()
    await loaded()
    expect(within(select('Ordenar')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Ordem manual', 'Ordenar: Prioridade', 'Ordenar: Prazo', 'Ordenar: Criação', 'Ordenar: Atualização', 'Ordenar: Título',
    ])
    expect(within(select('Prioridade')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todas as prioridades', 'Muito alta', 'Alta', 'Média', 'Baixa', 'Muito baixa', 'Sem prioridade',
    ])
    expect(within(select('Tipo')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Todos os tipos', 'BUG', 'HOTFIX', 'HISTÓRIA', 'Sem tipo'])
    expect(within(select('Prazo')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Qualquer prazo', 'Atrasados', 'Com prazo', 'Sem prazo'])
  })

  it('says "Nenhum card com esses filtros." and clears them from the panel', async () => {
    setup({}, { cards: rich })
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))
    fireEvent.change(select('Prioridade'), { target: { value: 'muito_alta' } })
    const panel = screen.getByText(/Nenhum card com esses filtros\./).closest('.v3-panel')
    expect(screen.getByRole('region', { name: 'Board' })).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.queryByText(/Nenhum card com esses filtros\./)).toBeNull()
    expect(select('Prioridade').value).toBe('')
    expect(titlesIn('A fazer')).toHaveLength(3)
  })

  it('"Limpar filtros" in the bar appears only with something to clear and resets view and project', async () => {
    setup({ workspaceKey: 'Pessoal' }, { cards: rich })
    await loaded()
    const bar = screen.getByRole('group', { name: 'Filtros do board' })
    expect(within(bar).queryByRole('button', { name: 'Limpar filtros' })).toBeNull()
    fireEvent.change(select('Ordenar'), { target: { value: 'titulo' } })
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    fireEvent.click(within(bar).getByRole('button', { name: 'Limpar filtros' }))
    expect(select('Ordenar').value).toBe('manual')
    expect(select('Projeto').value).toBe('')
    expect(within(bar).queryByRole('button', { name: 'Limpar filtros' })).toBeNull()
  })

  it('remembers the view across a reload and writes only the known keys', async () => {
    const first = setup({}, { cards: rich })
    await loaded()
    fireEvent.change(select('Prioridade'), { target: { value: 'alta' } })
    fireEvent.change(select('Ordenar'), { target: { value: 'prazo' } })
    expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY))).toEqual({
      prioridade: 'alta', tipo: '', prazo: '', sort: 'prazo',
    })
    first.unmount()
    vi.restoreAllMocks()
    setup({}, { cards: rich })
    await loaded()
    expect(select('Prioridade').value).toBe('alta')
    expect(select('Ordenar').value).toBe('prazo')
  })

  it('survives a storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    setup({}, { cards: rich })
    await loaded()
    fireEvent.change(select('Prioridade'), { target: { value: 'alta' } })
    expect(select('Prioridade').value).toBe('alta')
  })

  it('a stale or hand-edited stored view is cleaned to the known shape', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ prioridade: 'alta', sort: 99, extra: 'x' }))
    setup({}, { cards: rich })
    await loaded()
    expect(select('Prioridade').value).toBe('alta')
    expect(select('Ordenar').value).toBe('manual')
  })
})

describe('BoardTab: what the header needs to know and the focus request', () => {
  it('tells the screen that a card lives outside every workspace (unfiltered request)', async () => {
    const onHasUnassigned = vi.fn()
    setup({ onHasUnassigned })
    await loaded()
    await waitFor(() => expect(onHasUnassigned).toHaveBeenCalledWith(true))
  })

  it('tells it false when every card has a place', async () => {
    const onHasUnassigned = vi.fn()
    setup({ onHasUnassigned }, { cards: [card(1, 'Pessoal/tn-sandbox'), card(2, 'Pessoal')] })
    await loaded()
    await waitFor(() => expect(onHasUnassigned).toHaveBeenCalledWith(false))
    expect(onHasUnassigned).not.toHaveBeenCalledWith(true)
  })

  it('does not decide anything while the cards are still loading', async () => {
    const onHasUnassigned = vi.fn()
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockReturnValue(new Promise(() => {}))
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} onHasUnassigned={onHasUnassigned} />)
    await loaded()
    expect(onHasUnassigned).not.toHaveBeenCalled()
  })

  it('a request narrowed to one project leaves the last answer alone', async () => {
    const onHasUnassigned = vi.fn()
    setup({ workspaceKey: 'Pessoal', onHasUnassigned })
    await loaded()
    await waitFor(() => expect(onHasUnassigned).toHaveBeenCalledWith(true))
    onHasUnassigned.mockClear()
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith(['Pessoal/tn-sandbox']))
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1']))
    expect(onHasUnassigned).not.toHaveBeenCalled()
  })

  it('moves the focus to the "Board" heading when asked and reports the request as served', async () => {
    const onFocusServed = vi.fn()
    setup({ focusRequest: 3, onFocusServed })
    await loaded()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Board', level: 2 }))
    expect(onFocusServed).toHaveBeenCalledWith(3)
  })

  it('does not take the focus without a request', async () => {
    setup()
    await loaded()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('BoardTab: height of the scroller', () => {
  const realHeight = window.innerHeight
  afterEach(() => {
    window.innerHeight = realHeight
  })

  function measureAt(top) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      const y = this.classList?.contains('v3-board__scroller') ? top : 0
      return { top: y, bottom: y, left: 0, right: 0, width: 0, height: 0, x: 0, y }
    })
  }

  it('takes what is left of the window below its own top edge, less the screen padding', async () => {
    window.innerHeight = 900
    measureAt(216)
    setup()
    const scroller = await loaded()
    expect(scroller.style.height).toBe('652px')
  })

  it('follows the window when it is resized', async () => {
    window.innerHeight = 900
    measureAt(216)
    setup()
    const scroller = await loaded()
    act(() => { window.innerHeight = 1000; window.dispatchEvent(new Event('resize')) })
    expect(scroller.style.height).toBe('752px')
  })

  it('never goes under 320 px', async () => {
    window.innerHeight = 640
    measureAt(300)
    setup()
    const scroller = await loaded()
    expect(scroller.style.height).toBe('320px')
  })
})
