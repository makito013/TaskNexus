import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MoveBanner from './MoveBanner.jsx'

describe('MoveBanner', () => {
  it('renders nothing when there is no notice', () => {
    const { container } = render(<MoveBanner notice={null} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['card', 'Não consegui mover o card. Ele voltou para onde estava.'],
    ['board_changed', 'O board mudou. Atualizei as colunas e o card voltou para onde estava.'],
    ['column', 'Não consegui mover a coluna. Ela voltou para onde estava.'],
    ['done', 'Não consegui marcar a coluna como concluída.'],
  ])('says what happened for a %s notice, in an alert', (kind, text) => {
    render(<MoveBanner notice={{ kind }} onDismiss={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain(text)
  })

  it('closes with a button of its own and asks nothing else of the person', () => {
    const onDismiss = vi.fn()
    render(<MoveBanner notice={{ kind: 'card' }} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not take the focus when it appears', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    render(<MoveBanner notice={{ kind: 'card' }} onDismiss={vi.fn()} />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
