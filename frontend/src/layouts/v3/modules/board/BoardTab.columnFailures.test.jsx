// Two things that come out of a board that is not alone: a column deleted in another tab (the
// failed request reads the columns again, so the ghost goes), and the project refinement of an
// archived project, which dies with "Mostrar arquivados" instead of coming back with it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import { ProjectsViewProvider, useProjectsView } from '../../ProjectsViewContext.jsx'
import BoardTab from './BoardTab.jsx'
import { card, COLUMNS, registry } from './boardFixtures.js'

installDialogElementStub()

const PLACE = 'Pessoal/tn-sandbox'
const index = registry()
const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const columnNames = () => screen.getAllByRole('group')
  .map((group) => group.getAttribute('aria-label'))
  .filter((label) => label.startsWith('Coluna '))
  .map((label) => label.replace('Coluna ', ''))
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

describe('BoardTab: a column that is gone in another tab', () => {
  async function setup() {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card(1, PLACE)])
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await screen.findByRole('region', { name: 'Board' })
    await waitFor(() => expect(screen.queryAllByLabelText('Carregando cards')).toHaveLength(0))
    api.fetchBoardColumns.mockResolvedValue(COLUMNS.filter((entry) => entry.slug !== 'em_andamento'))
  }

  it('a delete that fails says so and the ghost column goes away', async () => {
    vi.spyOn(api, 'deleteBoardColumn').mockRejectedValue(new Error('Coluna não encontrada'))
    await setup()
    openMenu('Em andamento')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Excluir coluna' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' })) })
    expect(within(dialog).getByRole('alert').textContent).toContain('Não consegui excluir. Tente de novo.')
    await waitFor(() => expect(columnNames()).toEqual(['A fazer', 'Feito']))
  })

  it('a rename that fails shows the reason inside and the ghost column goes away', async () => {
    vi.spyOn(api, 'updateBoardColumn').mockRejectedValue(new Error('Coluna não encontrada'))
    await setup()
    openMenu('Em andamento')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Renomear coluna' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nome da coluna' }), { target: { value: 'Outro' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' })) })
    expect(within(dialog).getByRole('alert').textContent).toContain('Coluna não encontrada')
    await waitFor(() => expect(columnNames()).toEqual(['A fazer', 'Feito']))
  })

  it('a "concluída" that fails says so in the banner and the ghost column goes away', async () => {
    vi.spyOn(api, 'setDoneColumn').mockRejectedValue(new Error('Coluna não encontrada'))
    await setup()
    openMenu('Em andamento')
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Marcar como concluída' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui marcar a coluna como concluída.')
    await waitFor(() => expect(columnNames()).toEqual(['A fazer', 'Feito']))
  })

  it('no connection while creating or renaming says it in pt-BR, not the engine\'s English', async () => {
    vi.spyOn(api, 'createBoardColumn').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(api, 'updateBoardColumn').mockRejectedValue(new TypeError('Load failed'))
    await setup()
    fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { target: { value: 'Nova' } })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome da nova coluna' }), { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain('Sem conexão com o servidor. Tente de novo.')
    expect(document.body.textContent).not.toContain('Failed to fetch')

    openMenu('A fazer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear coluna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Renomear coluna' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nome da coluna' }), { target: { value: 'Outro' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' })) })
    expect(within(dialog).getByRole('alert').textContent).toContain('Sem conexão com o servidor. Tente de novo.')
    expect(document.body.textContent).not.toContain('Load failed')
    expect(column('A fazer')).toBeTruthy()
  })
})

describe('BoardTab: the refinement of a project that was archived', () => {
  const select = () => screen.getByRole('combobox', { name: 'Projeto' })
  let seen

  function Probe() {
    seen = useProjectsView().boardProject
    return null
  }

  function renderBoard(showArchived) {
    return (
      <ProjectsViewProvider>
        <Probe />
        <BoardTab registry={index} workspaceKey="Pessoal" showArchived={showArchived} />
      </ProjectsViewProvider>
    )
  }

  beforeEach(() => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card(1, PLACE), card(2, 'Pessoal/old')])
  })

  it('turning "Mostrar arquivados" off drops it, and turning it on again does not bring it back', async () => {
    const view = render(renderBoard(true))
    await screen.findByRole('region', { name: 'Board' })
    fireEvent.change(select(), { target: { value: 'Pessoal/old' } })
    expect(seen).toEqual({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/old' })

    view.rerender(renderBoard(false))
    expect(select().value).toBe('')
    await waitFor(() => expect(seen).toEqual({ workspaceKey: 'Pessoal', projectKey: '' }))

    view.rerender(renderBoard(true))
    expect(select().value).toBe('')
    expect(seen).toEqual({ workspaceKey: 'Pessoal', projectKey: '' })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith([]))
  })

  it('a project that is not archived keeps its refinement when the switch goes off and on', async () => {
    const view = render(renderBoard(true))
    await screen.findByRole('region', { name: 'Board' })
    fireEvent.change(select(), { target: { value: PLACE } })
    view.rerender(renderBoard(false))
    view.rerender(renderBoard(true))
    expect(select().value).toBe(PLACE)
    expect(seen).toEqual({ workspaceKey: 'Pessoal', projectKey: PLACE })
  })
})
