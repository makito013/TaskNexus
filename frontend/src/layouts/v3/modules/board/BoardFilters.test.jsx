import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DEFAULT_BOARD_VIEW } from '../../../../utils/boardView.js'
import BoardControls from './BoardControls.jsx'
import BoardFilters, { SORT_CHOICES } from './BoardFilters.jsx'

const PROJECTS = [
  { value: '', label: 'Todos os projetos' },
  { value: 'Pessoal/a', label: 'a' },
]

function renderFilters(props = {}) {
  const onViewChange = vi.fn()
  const onProjectChange = vi.fn()
  render(
    <BoardFilters
      view={{ ...DEFAULT_BOARD_VIEW }}
      onViewChange={onViewChange}
      projectOptions={PROJECTS}
      projectKey=""
      onProjectChange={onProjectChange}
      projectDisabled={false}
      {...props}
    />,
  )
  return { onViewChange, onProjectChange }
}

describe('BoardFilters', () => {
  it('has the five selects, each with an accessible name in Portuguese', () => {
    renderFilters()
    for (const name of ['Projeto', 'Prioridade', 'Tipo', 'Prazo', 'Ordenar']) {
      expect(screen.getByRole('combobox', { name })).toBeTruthy()
    }
  })

  it('a change keeps the other fields of the view', () => {
    const { onViewChange } = renderFilters({ view: { ...DEFAULT_BOARD_VIEW, tipo: 'bug' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Prioridade' }), { target: { value: 'alta' } })
    expect(onViewChange).toHaveBeenCalledWith({ ...DEFAULT_BOARD_VIEW, tipo: 'bug', prioridade: 'alta' })
  })

  it('reports the project on its own channel', () => {
    const { onProjectChange, onViewChange } = renderFilters()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/a' } })
    expect(onProjectChange).toHaveBeenCalledWith('Pessoal/a')
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('disables only the project select when asked', () => {
    renderFilters({ projectDisabled: true })
    expect(screen.getByRole('combobox', { name: 'Projeto' }).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Prioridade' }).disabled).toBe(false)
  })

  it('marks an active filter by the border class and by the title, not by colour alone', () => {
    renderFilters({ view: { ...DEFAULT_BOARD_VIEW, prazo: 'atrasado' } })
    const due = screen.getByRole('combobox', { name: 'Prazo' })
    expect(due.className).toContain('v3-board-select--active')
    expect(due.getAttribute('title')).toBe('Prazo (filtrado)')
    const type = screen.getByRole('combobox', { name: 'Tipo' })
    expect(type.className).not.toContain('active')
    expect(type.getAttribute('title')).toBe('Tipo')
  })

  it('the default sort is not "active"; another sort is', () => {
    const first = render(<BoardFilters view={{ ...DEFAULT_BOARD_VIEW }} onViewChange={() => {}} projectOptions={PROJECTS} projectKey="" onProjectChange={() => {}} />)
    expect(within(first.container).getByRole('combobox', { name: 'Ordenar' }).className).not.toContain('active')
    first.unmount()
    render(<BoardFilters view={{ ...DEFAULT_BOARD_VIEW, sort: 'titulo' }} onViewChange={() => {}} projectOptions={PROJECTS} projectKey="" onProjectChange={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Ordenar' }).className).toContain('active')
  })

  it('offers the same sort keys as the V2 board, with the V3 wording', () => {
    expect(SORT_CHOICES.map((choice) => choice.value)).toEqual(['manual', 'prioridade', 'prazo', 'criado_em', 'atualizado_em', 'titulo'])
  })
})

describe('BoardControls', () => {
  const base = {
    view: { ...DEFAULT_BOARD_VIEW },
    onViewChange: () => {},
    projectOptions: PROJECTS,
    projectKey: '',
    onProjectChange: () => {},
    projectDisabled: false,
    sorted: false,
    clearable: false,
    onClear: () => {},
    stale: false,
  }

  it('is a named group with only the selects when nothing is going on', () => {
    render(<BoardControls {...base} />)
    const group = screen.getByRole('group', { name: 'Filtros do board' })
    expect(within(group).queryByRole('button')).toBeNull()
    expect(within(group).queryByRole('status')).toBeNull()
    expect(within(group).queryByText(/arrastar/)).toBeNull()
  })

  it('shows "Limpar filtros", the sort hint and the stale chip when they apply', () => {
    const onClear = vi.fn()
    render(<BoardControls {...base} clearable sorted stale onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Com ordenação, arrastar muda só a coluna do card.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Sem atualizar agora')
  })
})
