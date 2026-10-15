import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Chip from './Chip.jsx'

describe('Chip', () => {
  it('renders the text with the tone class', () => {
    render(<Chip tone="id">#132</Chip>)
    const chip = screen.getByText('#132')
    expect(chip.className).toContain('v3-chip v3-chip--id')
  })

  it('state tone renders a decorative dot', () => {
    const { container } = render(<Chip tone="state" accent="navi">Concluída</Chip>)
    const dot = container.querySelector('.v3-chip__dot')
    expect(dot).not.toBeNull()
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Concluída')).toBeTruthy()
  })

  it('other tones render no dot', () => {
    const { container } = render(<Chip>Validação</Chip>)
    expect(container.querySelector('.v3-chip__dot')).toBeNull()
  })

  it('module tint is applied through a class, never inline color', () => {
    render(<Chip tone="state" accent="tiq">Pendente</Chip>)
    const chip = screen.getByText('Pendente')
    expect(chip.className).toContain('v3-chip--accent-tiq')
    expect(chip.getAttribute('style')).toBeNull()
  })

  it('badge tone maps the card kind to a class', () => {
    render(<Chip tone="badge" kind="bug">bug</Chip>)
    expect(screen.getByText('bug').className).toContain('v3-chip--kind-bug')
  })
})
