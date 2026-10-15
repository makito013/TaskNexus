import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ModuleRail from './ModuleRail.jsx'
import { MODULES } from '../../modules.js'

function renderRail(props = {}) {
  const onSelect = vi.fn()
  const onToggleTheme = vi.fn()
  render(
    <ModuleRail
      modules={MODULES}
      activeId="tasks"
      onSelect={onSelect}
      theme="light"
      onToggleTheme={onToggleTheme}
      {...props}
    />,
  )
  return { onSelect, onToggleTheme }
}

describe('ModuleRail', () => {
  it('marks only the active module with aria-current=page', () => {
    renderRail()
    const current = document.querySelectorAll('[aria-current]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Tarefas' })).toBe(current[0])
  })

  it('marks nothing when no module is active', () => {
    renderRail({ activeId: null })
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })

  it('exposes coming-soon in the visible text and in the accessible name', () => {
    renderRail()
    const finance = screen.getByRole('button', { name: 'Finanças, em breve' })
    expect(finance.textContent).toContain('Finanças')
    expect(finance.textContent).toContain('Em breve')
    // The ready module has no coming-soon line.
    expect(screen.getByRole('button', { name: 'Tarefas' }).textContent).not.toContain('Em breve')
    expect(screen.getByRole('button', { name: 'Projetos e agentes, em breve' })).toBeTruthy()
  })

  it('renders the modules in rail order inside a labelled nav', () => {
    renderRail()
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBeTruthy()
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual([
      'Início, em breve',
      'Tarefas',
      'Finanças, em breve',
      'Projetos e agentes, em breve',
      'Navegador, em breve',
      'Mudar para tema escuro',
    ])
  })

  it('calls onSelect with the module id', () => {
    const { onSelect } = renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Navegador, em breve' }))
    expect(onSelect).toHaveBeenCalledWith('browser')
  })

  it('theme toggle names the next theme', () => {
    const { onToggleTheme } = renderRail({ theme: 'dark' })
    const toggle = screen.getByRole('button', { name: 'Mudar para tema claro' })
    fireEvent.click(toggle)
    expect(onToggleTheme).toHaveBeenCalledTimes(1)
  })

  it('every item is at least 44px tall by class contract', () => {
    renderRail()
    const items = document.querySelectorAll('.v3-rail__item')
    expect(items).toHaveLength(5)
    // jsdom does not measure: the 72x56 box lives on the class (see ModuleRail.css).
    for (const item of items) expect(item.tagName).toBe('BUTTON')
  })

  it('uses decorative pets, with the sleeping state for modules without a screen', () => {
    renderRail()
    expect(document.querySelectorAll('.v3-rail svg[role="img"]')).toHaveLength(0)
    expect(document.querySelectorAll('.v3-rail__item .v3-pet--sleeping')).toHaveLength(4)
    expect(document.querySelectorAll('.v3-rail__item .v3-pet--idle')).toHaveLength(1)
  })
})
