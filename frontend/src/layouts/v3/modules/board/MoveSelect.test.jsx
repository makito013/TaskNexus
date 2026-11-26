import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import MoveSelect from './MoveSelect.jsx'
import { card, COLUMNS } from './boardFixtures.js'

const face = card(1, 'Pessoal/tn-sandbox', { titulo: 'Escrever o plano' })

function setup(props = {}) {
  const onChange = props.onChange ?? vi.fn().mockResolvedValue(true)
  const view = render(<MoveSelect card={face} columns={COLUMNS} onChange={onChange} {...props} />)
  return { ...view, onChange, select: screen.getByRole('combobox', { name: 'Mover "Escrever o plano"' }) }
}

describe('MoveSelect', () => {
  it('names the card, shows the column it is in and offers every column in order, the done one marked', () => {
    const { select } = setup()
    expect(select.value).toBe('a_fazer')
    expect([...select.options].map((option) => option.textContent)).toEqual(['A fazer', 'Em andamento', 'Feito (concluída)'])
    expect([...select.options].map((option) => option.value)).toEqual(['a_fazer', 'em_andamento', 'feito'])
  })

  it('says in words what it is for (a hidden hint the select is described by)', () => {
    const { select } = setup()
    const hint = document.getElementById(select.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('Mover para outra coluna')
    expect(hint.className).toContain('v3-projects__sr-only')
  })

  it('is a control of the card: it does not open the card and its press does not arm a drag', () => {
    const parentMouseDown = vi.fn()
    const parentTouchStart = vi.fn()
    render(
      <div onMouseDown={parentMouseDown} onTouchStart={parentTouchStart}>
        <MoveSelect card={face} columns={COLUMNS} onChange={vi.fn()} />
      </div>,
    )
    const select = screen.getByRole('combobox')
    expect(select.closest('[data-card-control]')).not.toBeNull()
    fireEvent.mouseDown(select)
    fireEvent.touchStart(select)
    expect(parentMouseDown).not.toHaveBeenCalled()
    expect(parentTouchStart).not.toHaveBeenCalled()
  })

  it('asks to move the card to the column picked, once', () => {
    const { select, onChange } = setup()
    fireEvent.change(select, { target: { value: 'feito' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(1, 'feito')
  })

  it('shows the choice as busy until the move is settled, then follows the card', async () => {
    let settle
    const onChange = vi.fn().mockReturnValue(new Promise((done) => { settle = done }))
    const { select, rerender } = setup({ onChange })
    fireEvent.change(select, { target: { value: 'em_andamento' } })
    expect(select.value).toBe('em_andamento')
    expect(select.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      rerender(<MoveSelect card={{ ...face, status: 'em_andamento' }} columns={COLUMNS} onChange={onChange} />)
      settle(true)
    })
    expect(select.value).toBe('em_andamento')
    expect(select.getAttribute('aria-busy')).toBeNull()
  })

  it('goes back to the column of the card when the move fails', async () => {
    const onChange = vi.fn().mockResolvedValue(false)
    const { select } = setup({ onChange })
    await act(async () => { fireEvent.change(select, { target: { value: 'feito' } }) })
    expect(select.value).toBe('a_fazer')
    expect(select.getAttribute('aria-busy')).toBeNull()
  })

  it('does not ask for a move to the column it is already in', () => {
    const { select, onChange } = setup()
    fireEvent.change(select, { target: { value: 'a_fazer' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
