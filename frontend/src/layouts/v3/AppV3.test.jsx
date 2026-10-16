import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react'
import { api } from '../../services/api.js'
import AppV3 from './AppV3.jsx'

function startAt(pathname) {
  window.history.replaceState({}, '', pathname)
}

function island() {
  return screen.getByRole('region', { name: 'Equipe' })
}

describe('AppV3', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    // The Tarefas screen fetches on mount; keep every test off the network.
    vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    startAt('/')
  })

  it('redirects / to /tasks with replaceState', () => {
    startAt('/')
    const replace = vi.spyOn(window.history, 'replaceState')
    const push = vi.spyOn(window.history, 'pushState')
    render(<AppV3 initialTheme="light" />)
    expect(replace).toHaveBeenCalledWith({}, '', '/tasks')
    expect(push).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/tasks')
    expect(screen.getByRole('heading', { level: 1, name: 'Tarefas' })).toBeTruthy()
  })

  it('redirects an unknown path to /tasks', () => {
    startAt('/tarefas')
    render(<AppV3 initialTheme="light" />)
    expect(window.location.pathname).toBe('/tasks')
    expect(screen.getByRole('button', { name: 'Tarefas' }).getAttribute('aria-current')).toBe('page')
  })

  it('switching modules updates island pet, name, message and aria-current', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    expect(island().querySelector('.v3-pet--tiq')).toBeTruthy()
    expect(screen.getByText('Tiq')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Finanças, em breve' }))

    expect(window.location.pathname).toBe('/finance')
    expect(island().querySelector('.v3-pet--fin')).toBeTruthy()
    expect(screen.getByText('Fin')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Ainda não cheguei por aqui.')
    const current = document.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-label')).toBe('Finanças, em breve')
  })

  it('coming-soon modules render ComingSoon with their pet', () => {
    startAt('/browser')
    render(<AppV3 initialTheme="light" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Navegador' })).toBeTruthy()
    expect(screen.getByRole('main').querySelector('.v3-pet--navi.v3-pet--sleeping')).toBeTruthy()
    expect(screen.getAllByText('Em breve').length).toBeGreaterThan(0)
  })

  it('does not focus the heading on the initial load', () => {
    startAt('/browser')
    render(<AppV3 initialTheme="light" />)
    expect(document.activeElement).toBe(document.body)
    cleanup()
    startAt('/')
    render(<AppV3 initialTheme="light" />)
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the new heading when the module changes, including back navigation', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Navegador, em breve' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Navegador' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Tarefas' }))
    act(() => {
      startAt('/browser')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Navegador' }))
  })

  it('opens a module from a colleague button on the island', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Projetos com Kan' }))
    expect(window.location.pathname).toBe('/projects')
    expect(screen.getByRole('heading', { level: 1, name: 'Projetos' })).toBeTruthy()
  })

  it('does not push a duplicate history entry when the active module is selected again', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    expect(push).not.toHaveBeenCalled()
  })

  it('theme toggle flips data-theme without calling updateAppearance', () => {
    const writer = vi.spyOn(api, 'updateAppearance').mockResolvedValue({})
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Mudar para tema escuro' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Mudar para tema claro' })).toBeTruthy()
    expect(writer).not.toHaveBeenCalled()
  })

  it('back button restores the previous module', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Início, em breve' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeTruthy()

    act(() => {
      startAt('/tasks')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Tarefas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tarefas' }).getAttribute('aria-current')).toBe('page')
  })

  it('treats the removed dev gallery path as unknown and opens the default module', () => {
    startAt('/dev/gallery')
    render(<AppV3 initialTheme="light" />)
    expect(window.location.pathname).toBe('/tasks')
    expect(screen.getByRole('heading', { level: 1, name: 'Tarefas' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /galeria/i })).toBeNull()
  })

  it('keeps one island element across module switches so the status phrase is announced', () => {
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    const before = island()
    fireEvent.click(screen.getByRole('button', { name: 'Finanças, em breve' }))
    expect(island()).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Navegador, em breve' }))
    expect(island()).toBe(before)
    expect(within(before).getByRole('status').textContent).toBe('Ainda estou me preparando.')
  })

  it('drives the island from the tasks data and falls back to the static phrase elsewhere', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([
      { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
      { slug: 'feito', label: 'Feito', position: 1, is_done: true },
    ])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([
      { id: 1, titulo: 'Atrasado', projeto_id: 'p', status: 'a_fazer', criado_em: 1, prazo: '2020-01-01', tipo: null, descricao: null },
    ])
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)

    await waitFor(() => expect(within(island()).getByRole('status').textContent).toBe('1 atrasada. Quer ver?'))
    expect(island().querySelector('.v3-pet--tiq.v3-pet--alert')).toBeTruthy()
    expect(within(island()).getByRole('button', { name: 'Ver atrasadas' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Finanças, em breve' }))
    expect(within(island()).getByRole('status').textContent).toBe('Ainda não cheguei por aqui.')
    expect(island().querySelector('.v3-pet--fin.v3-pet--sleeping')).toBeTruthy()
    expect(within(island()).queryByRole('button', { name: 'Ver atrasadas' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    await waitFor(() => expect(within(island()).getByRole('status').textContent).toBe('1 atrasada. Quer ver?'))
  })

  it('renders exactly one h1 on every screen', async () => {
    for (const route of ['/tasks', '/home', '/finance', '/projects', '/browser']) {
      startAt(route)
      const { container, unmount } = render(<AppV3 initialTheme="light" />)
      await waitFor(() => expect(container.querySelectorAll('h1')).toHaveLength(1))
      expect(container.querySelectorAll('h1[tabindex="-1"]')).toHaveLength(1)
      unmount()
    }
  })

  it('after the redirect the route state is the replaced path, so the active module is not pushed again', () => {
    startAt('/')
    const push = vi.spyOn(window.history, 'pushState')
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Finanças, em breve' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({}, '', '/finance')
  })
})
