import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import PermissionCard from './PermissionCard.jsx'

installDialogElementStub()
afterEach(() => cleanup())

const TRICK = 'cat \u202Egpj.txt && echo \u200Bsafe'
const BASH = { id: 'p1', kind: 'tool', toolName: 'Bash', input: { command: TRICK }, allowSession: false, status: 'pending' }
const PLAIN = { ...BASH, id: 'p2', input: { command: 'npm test' } }
const WRITE = { id: 'p3', kind: 'tool', toolName: 'Write', input: { file_path: 'C:/w/a.txt', content: 'x\u202Ey' }, allowSession: true, status: 'pending' }
const OTHER = { id: 'p4', kind: 'tool', toolName: 'WebFetch', input: { url: 'http://a/\u2066b' }, allowSession: true, status: 'pending' }

function setup(card, phone = false) {
  return render(<PermissionCard card={card} agentName="Claude" context="tn" onDecide={vi.fn()} focusAfterDecision={vi.fn()} phone={phone} />)
}

describe('the approval card shows invisible and reordering characters (stage 10, Y1)', () => {
  it('marks them in the command and warns', () => {
    const { container } = setup(BASH)
    const code = container.querySelector('.v3-approval__object-text')
    expect(code.textContent).toBe('cat ⟦U+202E⟧gpj.txt && echo ⟦U+200B⟧safe')
    expect(code.textContent).not.toMatch(/[\u202E\u200B]/)
    expect(screen.getByRole('note').textContent).toMatch(/caracteres invisíveis/)
  })

  it('shows no warning for an ordinary command', () => {
    setup(PLAIN)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('the sentence read by a screen reader carries the markers too', () => {
    const { container } = setup(BASH)
    expect(container.querySelector('.v3-approval__sr-only').textContent).toContain('⟦U+202E⟧')
  })

  it('marks them in the diff', () => {
    const { container } = setup(WRITE)
    fireEvent.click(screen.getByRole('button', { name: /Ver detalhes/ }))
    expect(container.querySelector('.v3-chat-diff__text').textContent).toBe('x⟦U+202E⟧y')
  })

  it('marks them in the input details', () => {
    const { container } = setup(OTHER)
    fireEvent.click(screen.getByRole('button', { name: /Ver detalhes/ }))
    expect(container.querySelector('.v3-chat-details').textContent).toContain('⟦U+2066⟧')
  })

  it('the phone card and the sheet mark them and warn', () => {
    const { container } = setup(BASH, true)
    expect(container.querySelector('.v3-approval__object-text').textContent).toContain('⟦U+202E⟧')
    fireEvent.click(screen.getByRole('button', { name: /Ver pedido completo/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('.v3-approval-sheet__object').textContent).toBe('cat ⟦U+202E⟧gpj.txt && echo ⟦U+200B⟧safe')
    expect(dialog.querySelector('[role="note"]').textContent).toMatch(/caracteres invisíveis/)
  })

  it('the decided card keeps the markers in its one-line summary', () => {
    const { container } = render(
      <PermissionCard card={BASH} agentName="Claude" decision={{ behavior: 'allow', scope: 'once' }} onDecide={vi.fn()} />,
    )
    expect(container.textContent).toContain('⟦U+202E⟧')
  })
})
