import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Island from './Island.jsx'
import { colleaguesOf } from '../../modules.js'

describe('Island', () => {
  it('renders the pet name, message and status region', () => {
    render(<Island pet="tiq" message="Pronto pra cuidar das suas tarefas." />)
    expect(screen.getByRole('region', { name: 'Equipe' })).toBeTruthy()
    const name = screen.getByText('Tiq')
    expect(name.className).toContain('v3-island__name--tiq')
    expect(screen.getByRole('status').textContent).toBe('Pronto pra cuidar das suas tarefas.')
  })

  it('renders the front pet decoratively with the given state', () => {
    render(<Island pet="fin" state="sleeping" message="Ainda não cheguei por aqui." />)
    expect(document.querySelector('.v3-island > .v3-pet--sleeping.v3-pet--fin')).toBeTruthy()
    expect(document.querySelector('.v3-island > svg').getAttribute('aria-hidden')).toBe('true')
  })

  it('renders only actions that have a handler', () => {
    const onClick = vi.fn()
    render(
      <Island
        pet="tiq"
        message="Oi"
        actions={[{ label: 'Ver atrasadas', onClick }, { label: 'Sem ação' }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ver atrasadas' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Sem ação' })).toBeNull()
  })

  it('renders no actions area when there are none', () => {
    render(<Island pet="bit" message="Oi" />)
    expect(document.querySelector('.v3-island__actions')).toBeNull()
    expect(document.querySelector('.v3-island__divider')).toBeNull()
  })

  it('renders colleagues as buttons that open the module', () => {
    const onColleagueSelect = vi.fn()
    render(
      <Island
        pet="tiq"
        message="Oi"
        colleagues={colleaguesOf('tasks')}
        onColleagueSelect={onColleagueSelect}
      />,
    )
    const buttons = document.querySelectorAll('.v3-island__colleague')
    expect(buttons).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Finanças com Fin' }))
    expect(onColleagueSelect).toHaveBeenCalledWith('finance')
    // Colleague pets are decorative: the name is on the button.
    expect(document.querySelectorAll('.v3-island__colleague svg[role="img"]')).toHaveLength(0)
  })

  it('primary action uses the module button variant and the others the island variant', () => {
    render(
      <Island
        pet="tiq"
        message="Oi"
        actions={[
          { label: 'Primeira', onClick: () => {} },
          { label: 'Segunda', onClick: () => {} },
        ]}
      />,
    )
    const first = screen.getByRole('button', { name: 'Primeira' })
    expect(first.className).toContain('v3-button--module')
    expect(first.className).toContain('v3-button--module-tiq')
    expect(screen.getByRole('button', { name: 'Segunda' }).className).toContain('v3-button--island')
  })
})
