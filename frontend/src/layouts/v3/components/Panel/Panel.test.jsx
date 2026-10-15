import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Panel from './Panel.jsx'

describe('Panel', () => {
  it('renders children in a panel', () => {
    const { container } = render(<Panel><p>Conteúdo</p></Panel>)
    const panel = container.firstChild
    expect(panel.className).toBe('v3-panel')
    expect(screen.getByText('Conteúdo')).toBeTruthy()
  })

  it('notice variant applies the tone class and role when given', () => {
    const { container } = render(<Panel notice="fin" role="alert">Falhou</Panel>)
    const panel = screen.getByRole('alert')
    expect(panel.className).toContain('v3-panel v3-panel--notice-fin')
    expect(panel.textContent).toBe('Falhou')
    expect(container.querySelector('.v3-panel__dot').getAttribute('aria-hidden')).toBe('true')
  })

  it('can render as another element', () => {
    render(<Panel as="aside" aria-label="Detalhe">x</Panel>)
    expect(screen.getByLabelText('Detalhe').tagName).toBe('ASIDE')
  })
})
