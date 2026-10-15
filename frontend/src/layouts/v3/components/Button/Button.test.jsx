import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Button from './Button.jsx'

describe('Button', () => {
  it('renders a native button with variant and size classes', () => {
    render(<Button variant="primary" size="lg">Salvar</Button>)
    const button = screen.getByRole('button', { name: 'Salvar' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveProperty('type', 'button')
    expect(button.className).toContain('v3-button v3-button--primary v3-button--lg')
  })

  it('module variant adds the module class', () => {
    render(<Button variant="module" module="tiq">Concluir</Button>)
    expect(screen.getByRole('button').className).toContain('v3-button--module-tiq')
  })

  it('module variant without a module falls back to tiq so the text is never invisible', () => {
    render(<Button variant="module">Concluir</Button>)
    expect(screen.getByRole('button').className).toContain('v3-button--module-tiq')
  })

  it('does not add a module class to other variants', () => {
    render(<Button variant="secondary">Reabrir</Button>)
    expect(screen.getByRole('button').className).not.toContain('v3-button--module-')
  })

  it('forwards native button props such as type and aria-busy', () => {
    render(<Button type="submit" aria-busy="true" disabled>Salvando…</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveProperty('type', 'submit')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button).toHaveProperty('disabled', true)
  })
})
