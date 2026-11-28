// A lazy chunk that fails to load (offline, a deploy replaced the files) affects only its own tab:
// the other tab still tries its own chunk.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import ProjectsScreen from './ProjectsScreen.jsx'

vi.mock('../board/BoardTab.jsx', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

const REGISTRY = {
  seeded: null,
  workspaces: [{ id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false, projects: [] }],
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
})
afterEach(() => vi.restoreAllMocks())

describe('Projetos: a failed chunk is per tab', () => {
  it('Board failing does not make Artefatos say "Não carregou."', async () => {
    render(<IslandProvider value={() => {}}><ProjectsScreen /></IslandProvider>)
    await screen.findByRole('tab', { name: 'Board' })
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Não carregou.')
    fireEvent.click(screen.getByRole('tab', { name: 'Artefatos' }))
    expect(await screen.findByRole('heading', { name: 'Artefatos' })).toBeTruthy()
    expect(screen.queryByText('Não carregou.')).toBeNull()
  })
})
