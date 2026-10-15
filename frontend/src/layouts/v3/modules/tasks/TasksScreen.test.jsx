import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { IslandProvider } from '../../IslandContext.jsx'
import TasksScreen from './TasksScreen.jsx'

// Thursday, 2026-10-15, local time; only Date is faked so waitFor keeps working.
const NOW = new Date(2026, 9, 15, 10, 0)

const validationTask = (overrides = {}) => ({
  id: 1,
  session_key: 'acme/site::claude',
  titulo: 'Validar login',
  descricao_markdown: 'Abrir a tela e **entrar**.',
  status: 'pending',
  created_at: 1000,
  completed_at: null,
  projeto_id: 'acme/site',
  agent_id: 'claude',
  session_display_name: null,
  ...overrides,
})

const boardCard = (overrides = {}) => ({
  id: 10,
  titulo: 'Corrigir cadastro',
  projeto_id: 'acme/site',
  status: 'a_fazer',
  descricao: null,
  criado_em: 2000,
  tipo: null,
  prazo: null,
  ...overrides,
})

const columns = [
  { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
  { slug: 'feito', label: 'Feito', position: 1, is_done: true },
]

const DEFAULT_TASKS = [
  validationTask(),
  validationTask({ id: 2, titulo: 'Validar logout', status: 'done', completed_at: 5000 }),
]
const DEFAULT_CARDS = [
  boardCard({ id: 10, titulo: 'Corrigir cadastro', prazo: '2026-10-10', tipo: 'bug', descricao: '# Passo a passo\n\ntexto **forte**\n\n<script>alert(1)</script>' }),
  boardCard({ id: 11, titulo: 'Publicar versão', prazo: '2026-10-15', tipo: 'historia' }),
  boardCard({ id: 12, titulo: 'Revisar textos' }),
  boardCard({ id: 13, titulo: 'Card entregue', status: 'feito', prazo: '2026-10-01' }),
]

const settle = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value))

function mockApi({ tasks = DEFAULT_TASKS, cards = DEFAULT_CARDS, cols = columns } = {}) {
  vi.spyOn(api, 'fetchGlobalTasks').mockImplementation(() => settle(tasks))
  vi.spyOn(api, 'fetchCards').mockImplementation(() => settle(cards))
  vi.spyOn(api, 'fetchBoardColumns').mockImplementation(() => settle(cols))
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([{ id: 'acme/site', nome: 'Site' }])
}

function renderScreen(report = vi.fn()) {
  render(
    <IslandProvider value={report}>
      <TasksScreen />
    </IslandProvider>,
  )
  return report
}

const list = () => screen.getByRole('list', { name: 'Tarefas' })
const rowTitles = () => within(list()).getAllByRole('listitem').map((row) => row.querySelector('.v3-task-row__title').textContent)
const filter = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const loaded = () => waitFor(() => expect(screen.queryByText('Carregando tarefas…')).toBeNull())
const lastReport = (report) => report.mock.calls.filter(([arg]) => arg).at(-1)[0]

describe('TasksScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows four static skeleton rows and a status text while loading', () => {
    vi.spyOn(api, 'fetchGlobalTasks').mockImplementation(() => new Promise(() => {}))
    vi.spyOn(api, 'fetchCards').mockImplementation(() => new Promise(() => {}))
    vi.spyOn(api, 'fetchBoardColumns').mockImplementation(() => new Promise(() => {}))
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
    const report = renderScreen()

    expect(screen.getByRole('status').textContent).toBe('Carregando tarefas…')
    const busyList = screen.getByRole('list', { name: 'Tarefas' })
    expect(busyList.getAttribute('aria-busy')).toBe('true')
    expect(busyList.querySelectorAll('.v3-task-row--skeleton')).toHaveLength(4)
    expect(filter('Pendentes').textContent).toContain('–')
    expect(lastReport(report)).toMatchObject({ moduleId: 'tasks', message: 'Separando suas tarefas…', state: 'thinking' })
  })

  it('renders the empty state copy for each filter', async () => {
    mockApi({ tasks: [], cards: [] })
    renderScreen()
    await loaded()

    expect(screen.getByText('Tudo em dia.')).toBeTruthy()
    expect(screen.getByText('Quando surgir uma tarefa de validação ou um card em aberto, ela aparece aqui.')).toBeTruthy()
    fireEvent.click(filter('Hoje'))
    expect(screen.getByText('Nada com prazo pra hoje.')).toBeTruthy()
    expect(screen.getByText('Os cards com prazo de hoje aparecem aqui.')).toBeTruthy()
    fireEvent.click(filter('Atrasadas'))
    expect(screen.getByText('Nenhuma atrasada.')).toBeTruthy()
    expect(screen.getByText('Bom sinal. Tô de olho nos prazos.')).toBeTruthy()
    fireEvent.click(filter('Concluídas'))
    expect(screen.getByText('Nada concluído ainda.')).toBeTruthy()
    expect(screen.getByText('As tarefas e cards concluídos aparecem aqui.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tarefas' })).toBeNull()
  })

  it('renders the total error alert with a retry button', async () => {
    mockApi({ tasks: new Error('down'), cards: new Error('down') })
    const report = renderScreen()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Não consegui buscar as tarefas.')).toBeTruthy()
    expect(within(alert).getByText('Confira a conexão com o TaskNexus e tente de novo.')).toBeTruthy()
    expect(lastReport(report)).toMatchObject({
      message: 'Não consegui buscar as tarefas. Tenta de novo?',
      state: 'alert',
    })
    expect(lastReport(report).actions.map((action) => action.label)).toEqual(['Tentar de novo'])

    const callsBefore = api.fetchCards.mock.calls.length
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(api.fetchCards.mock.calls.length).toBe(callsBefore + 1))
  })

  it('renders one partial notice per failed source', async () => {
    mockApi({ tasks: new Error('down') })
    const { unmount } = render(<IslandProvider value={vi.fn()}><TasksScreen /></IslandProvider>)
    expect(await screen.findByText('Não consegui carregar as tarefas de validação. Mostrando só os cards.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(rowTitles()).toContain('Corrigir cadastro')
    unmount()

    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockApi({ cards: new Error('down') })
    const second = render(<IslandProvider value={vi.fn()}><TasksScreen /></IslandProvider>)
    expect(await screen.findByText('Não consegui carregar os cards. Mostrando só as tarefas de validação.')).toBeTruthy()
    expect(rowTitles()).toEqual(['Validar login'])
    second.unmount()

    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockApi({ cols: new Error('down') })
    render(<IslandProvider value={vi.fn()}><TasksScreen /></IslandProvider>)
    expect(await screen.findByText('Não sei quais cards já foram concluídos, então não marco atrasos.')).toBeTruthy()
    expect(within(list()).queryByText(/^Atrasada/)).toBeNull()
  })

  it('filters are exclusive buttons with aria-pressed and counts', async () => {
    mockApi()
    renderScreen()
    await loaded()

    expect(filter('Pendentes').getAttribute('aria-pressed')).toBe('true')
    expect(filter('Pendentes').textContent).toContain('4')
    expect(filter('Hoje').textContent).toContain('1')
    expect(filter('Atrasadas').textContent).toContain('1')
    expect(filter('Concluídas').textContent).toContain('2')
    expect(screen.getByText('Hoje e Atrasadas contam só cards com prazo.')).toBeTruthy()

    fireEvent.click(filter('Concluídas'))
    expect(filter('Concluídas').getAttribute('aria-pressed')).toBe('true')
    expect(filter('Pendentes').getAttribute('aria-pressed')).toBe('false')
    expect(rowTitles().sort()).toEqual(['Card entregue', 'Validar logout'])
  })

  it('lists pending items overdue first and marks overdue and today with text, not only color', async () => {
    mockApi()
    renderScreen()
    await loaded()

    expect(rowTitles()).toEqual(['Validar login', 'Corrigir cadastro', 'Publicar versão', 'Revisar textos'])
    const overdueRow = within(list()).getByText('Atrasada · 10 out')
    expect(overdueRow.className).toContain('v3-task-row__due--alert')
    const todayRow = within(list()).getByText('Hoje')
    expect(todayRow.className).toContain('v3-task-row__due--alert')
    expect(within(list()).getAllByText('Sem prazo')).toHaveLength(2)
  })

  it('header summary reflects the counts', async () => {
    mockApi()
    renderScreen()
    await loaded()
    expect(screen.getByText('4 pendentes · 1 com prazo hoje · 1 atrasada')).toBeTruthy()
  })

  it('checkbox label names the task', async () => {
    mockApi()
    renderScreen()
    await loaded()
    expect(screen.getByRole('checkbox', { name: 'Concluir Validar login' })).toBeTruthy()
    fireEvent.click(filter('Concluídas'))
    expect(screen.getByRole('checkbox', { name: 'Reabrir Validar logout' }).checked).toBe(true)
    // cards have no control
    expect(within(list()).getAllByRole('checkbox')).toHaveLength(1)
  })

  it('selecting a row shows the detail panel and marks the row aria-current', async () => {
    mockApi()
    renderScreen()
    await loaded()

    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    expect(within(detail).getByText('Escolha uma tarefa pra ver os detalhes.')).toBeTruthy()

    fireEvent.click(within(list()).getByText('Validar login'))
    expect(within(detail).getByRole('heading', { level: 2, name: 'Validar login' })).toBeTruthy()
    expect(within(detail).getByText('Projeto: Site')).toBeTruthy()
    expect(within(detail).getByText('Pendente')).toBeTruthy()
    const current = list().querySelectorAll('[aria-current="true"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Validar login')
  })

  it('card detail shows the read-only board notice and the id chip', async () => {
    mockApi()
    renderScreen()
    await loaded()

    fireEvent.click(within(list()).getByText('Corrigir cadastro'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    expect(within(detail).getByText('#10')).toBeTruthy()
    expect(within(detail).getByText('BUG')).toBeTruthy()
    expect(within(detail).getByText('Atrasada')).toBeTruthy()
    expect(within(detail).getByText('Sábado, 10 de outubro')).toBeTruthy()
    expect(within(detail).getByText('Atrasada há 5 dias')).toBeTruthy()
    expect(within(detail).getByText('Esse card vem do board. Aqui eu só mostro; pra mexer, use o layout atual.')).toBeTruthy()
    expect(within(detail).queryByRole('button')).toBeNull()
  })

  it('renders the description as sanitized prose with a single h1 on the screen', async () => {
    mockApi()
    const { container } = render(<IslandProvider value={vi.fn()}><TasksScreen /></IslandProvider>)
    await waitFor(() => expect(screen.queryByText('Carregando tarefas…')).toBeNull())

    fireEvent.click(within(list()).getByText('Corrigir cadastro'))
    const prose = container.querySelector('.v3-prose')
    expect(prose.querySelector('strong').textContent).toBe('forte')
    expect(prose.querySelector('script')).toBeNull()
    expect(prose.querySelector('h1')).toBeNull()
    expect(prose.querySelector('h3').textContent).toBe('Passo a passo')
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('h1').hasAttribute('tabindex')).toBe(true)
  })

  it('shows an empty description fallback', async () => {
    mockApi()
    renderScreen()
    await loaded()
    fireEvent.click(within(list()).getByText('Revisar textos'))
    expect(screen.getByText('Sem descrição.')).toBeTruthy()
  })

  it('complete and reopen appear only for validation items', async () => {
    mockApi()
    renderScreen()
    await loaded()

    fireEvent.click(within(list()).getByText('Validar login'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    expect(within(detail).getByRole('button', { name: 'Concluir' })).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: 'Reabrir' })).toBeNull()

    fireEvent.click(filter('Concluídas'))
    fireEvent.click(within(list()).getByText('Validar logout'))
    expect(within(detail).getByRole('button', { name: 'Reabrir' })).toBeTruthy()

    fireEvent.click(within(list()).getByText('Card entregue'))
    expect(within(detail).queryByRole('button')).toBeNull()
  })

  it('detail returns to the placeholder when the selected item leaves the filter', async () => {
    mockApi()
    renderScreen()
    await loaded()

    fireEvent.click(within(list()).getByText('Validar login'))
    fireEvent.click(filter('Concluídas'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    expect(within(detail).getByText('Escolha uma tarefa pra ver os detalhes.')).toBeTruthy()
  })

  it('shows Salvando while a mutation is pending and moves the row once it is saved', async () => {
    mockApi()
    let resolveComplete
    vi.spyOn(api, 'completeTask').mockImplementation(() => new Promise((resolve) => { resolveComplete = resolve }))
    renderScreen()
    await loaded()

    fireEvent.click(within(list()).getByText('Validar login'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    fireEvent.click(within(detail).getByRole('button', { name: 'Concluir' }))

    const busy = await within(detail).findByRole('button', { name: 'Salvando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(api.completeTask).toHaveBeenCalledWith('acme/site::claude', 1)

    await act(async () => { resolveComplete({ status: 'done' }) })
    await waitFor(() => expect(within(detail).getByText('Escolha uma tarefa pra ver os detalhes.')).toBeTruthy())
    expect(rowTitles()).not.toContain('Validar login')
    expect(filter('Concluídas').textContent).toContain('3')
  })

  it('shows an inline notice and keeps the task open when saving fails', async () => {
    mockApi()
    vi.spyOn(api, 'completeTask').mockRejectedValue(new Error('boom'))
    global.alert = vi.fn()
    renderScreen()
    await loaded()

    fireEvent.click(within(list()).getByText('Validar login'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    fireEvent.click(within(detail).getByRole('button', { name: 'Concluir' }))

    expect(await within(detail).findByText('Não consegui salvar. Tenta de novo?')).toBeTruthy()
    expect(within(detail).getByRole('button', { name: 'Concluir' })).toBeTruthy()
    expect(rowTitles()).toContain('Validar login')
    expect(global.alert).not.toHaveBeenCalled()
  })

  it('completing from the row checkbox reports the failure in the list column', async () => {
    mockApi()
    vi.spyOn(api, 'completeTask').mockRejectedValue(new Error('boom'))
    renderScreen()
    await loaded()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir Validar login' }))
    expect(await screen.findByText('Não consegui salvar. Tenta de novo?')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Concluir Validar login' }).checked).toBe(false)
  })

  it('shows an item save failure only on the item it came from', async () => {
    mockApi({ tasks: [validationTask(), validationTask({ id: 2, titulo: 'Validar logout' })] })
    vi.spyOn(api, 'completeTask').mockRejectedValue(new Error('boom'))
    renderScreen()
    await loaded()

    // fails from the checkbox of A while nothing is selected: notice in the list column
    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir Validar login' }))
    expect(await screen.findByText('Não consegui salvar. Tenta de novo?')).toBeTruthy()

    // selecting B dismisses it: B never failed
    fireEvent.click(within(list()).getByText('Validar logout'))
    const detail = screen.getByRole('complementary', { name: 'Detalhe da tarefa' })
    expect(within(detail).queryByText('Não consegui salvar. Tenta de novo?')).toBeNull()
    expect(screen.queryByText('Não consegui salvar. Tenta de novo?')).toBeNull()

    // a failure of B shows in B's detail, and moving to A hides it again
    fireEvent.click(within(detail).getByRole('button', { name: 'Concluir' }))
    expect(await within(detail).findByText('Não consegui salvar. Tenta de novo?')).toBeTruthy()
    fireEvent.click(within(list()).getByText('Validar login'))
    expect(screen.queryByText('Não consegui salvar. Tenta de novo?')).toBeNull()
  })

  it('island receives the derived message, state and the overdue action', async () => {
    mockApi()
    const report = renderScreen()
    await loaded()

    const content = lastReport(report)
    expect(content).toMatchObject({
      moduleId: 'tasks',
      message: '1 pra hoje e 1 atrasada. Quer ver as atrasadas?',
      state: 'alert',
    })
    expect(content.actions.map((action) => action.label)).toEqual(['Ver atrasadas'])

    await act(async () => { content.actions[0].onClick() })
    expect(filter('Atrasadas').getAttribute('aria-pressed')).toBe('true')
    expect(rowTitles()).toEqual(['Corrigir cadastro'])
    // opening Atrasadas acknowledges the alert: the pet calms down, the phrase stays
    expect(lastReport(report).state).toBe('idle')
  })

  it('clears the island report when the screen unmounts', async () => {
    mockApi()
    const report = vi.fn()
    const { unmount } = render(<IslandProvider value={report}><TasksScreen /></IslandProvider>)
    await waitFor(() => expect(screen.queryByText('Carregando tarefas…')).toBeNull())
    unmount()
    expect(report).toHaveBeenLastCalledWith(null)
  })

  it('does not call updateAppearance or write anything on load', async () => {
    mockApi()
    const writer = vi.spyOn(api, 'updateAppearance').mockResolvedValue({})
    renderScreen()
    await loaded()
    expect(writer).not.toHaveBeenCalled()
  })
})
