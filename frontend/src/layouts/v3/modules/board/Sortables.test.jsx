import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const useSortable = vi.fn()
const useDroppable = vi.fn()

vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  ...(await importOriginal()),
  useSortable: (...args) => useSortable(...args),
}))
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useDroppable: (...args) => useDroppable(...args),
  DragOverlay: ({ children, dropAnimation }) => (
    <div data-testid="overlay-host" data-drop-animation={dropAnimation === null ? 'none' : 'default'}>{children}</div>
  ),
}))

const { default: SortableColumn } = await import('./SortableColumn.jsx')
const { default: SortableCard } = await import('./SortableCard.jsx')
const { default: BoardOverlay } = await import('./BoardOverlay.jsx')
const { default: DropLine } = await import('./DropLine.jsx')
const { card, COLUMNS } = await import('./boardFixtures.js')

const sortableState = (extra = {}) => ({
  listeners: { onMouseDown: vi.fn(), onTouchStart: vi.fn() },
  attributes: { role: 'button', tabIndex: 0, 'aria-describedby': 'DndDescribedBy-0' },
  setNodeRef: vi.fn(),
  setActivatorNodeRef: vi.fn(),
  transform: null,
  transition: undefined,
  isDragging: false,
  ...extra,
})

beforeEach(() => {
  useSortable.mockReturnValue(sortableState())
  useDroppable.mockReturnValue({ setNodeRef: vi.fn(), isOver: false })
})
afterEach(() => {
  vi.restoreAllMocks()
  useSortable.mockReset()
  useDroppable.mockReset()
})

describe('SortableCard', () => {
  it('is a list item sortable under the card namespace, holding what it is given', () => {
    render(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    expect(useSortable).toHaveBeenCalledWith({ id: 'card:7' })
    const item = screen.getByRole('listitem')
    expect(item.textContent).toBe('face')
  })

  it('arms the drag through the listeners of the sensors', () => {
    const state = sortableState()
    useSortable.mockReturnValue(state)
    render(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    fireEvent.mouseDown(screen.getByRole('listitem'))
    fireEvent.touchStart(screen.getByRole('listitem'))
    expect(state.listeners.onMouseDown).toHaveBeenCalledTimes(1)
    expect(state.listeners.onTouchStart).toHaveBeenCalledTimes(1)
  })

  it('drops the generic attributes of dnd-kit: no button role, no focus stop, no English description', () => {
    render(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    const item = screen.getByRole('listitem')
    expect(item.getAttribute('role')).toBeNull()
    expect(item.getAttribute('tabindex')).toBeNull()
    expect(item.getAttribute('aria-describedby')).toBeNull()
  })

  it('moves by the translation of dnd-kit, only on itself', () => {
    useSortable.mockReturnValue(sortableState({ transform: { x: 4, y: 12, scaleX: 1, scaleY: 1 }, transition: 'transform 200ms ease' }))
    render(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    const item = screen.getByRole('listitem')
    expect(item.style.transform).toBe('translate3d(4px, 12px, 0)')
    expect(item.style.transition).toBe('transform 200ms ease')
  })

  it('stays in the flow, marked, while it is the one being dragged', () => {
    const { rerender } = render(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    expect(screen.getByRole('listitem').className).not.toContain('v3-board-sortable--dragging')
    useSortable.mockReturnValue(sortableState({ isDragging: true }))
    rerender(<ul><SortableCard cardId={7}><span>face</span></SortableCard></ul>)
    expect(screen.getByRole('listitem').className).toContain('v3-board-sortable--dragging')
  })
})

describe('SortableColumn', () => {
  it('is sortable by its slug and a drop target for cards under its own id', () => {
    render(<SortableColumn slug="feito">{() => <p>coluna</p>}</SortableColumn>)
    expect(useSortable).toHaveBeenCalledWith({ id: 'feito' })
    expect(useDroppable).toHaveBeenCalledWith({ id: 'dropzone:feito' })
  })

  it('hands the header its drag props and the body its drop target', () => {
    const state = sortableState()
    const zone = { setNodeRef: vi.fn(), isOver: true }
    useSortable.mockReturnValue(state)
    useDroppable.mockReturnValue(zone)
    const seen = vi.fn(() => <p>coluna</p>)
    render(<SortableColumn slug="feito">{seen}</SortableColumn>)
    const given = seen.mock.calls[0][0]
    expect(given.handleProps.ref).toBe(state.setActivatorNodeRef)
    expect(given.handleProps.onMouseDown).toBe(state.listeners.onMouseDown)
    expect(given.handleProps.onTouchStart).toBe(state.listeners.onTouchStart)
    expect(given.handleProps.role).toBeUndefined()
    expect(given.handleProps.tabIndex).toBeUndefined()
    expect(given.dropzoneRef).toBe(zone.setNodeRef)
    expect(given.cardOver).toBe(true)
    expect(given.isDragging).toBe(false)
  })

  it('moves by the translation of dnd-kit and is marked while it is dragged', () => {
    useSortable.mockReturnValue(sortableState({ transform: { x: -284, y: 0, scaleX: 1, scaleY: 1 }, isDragging: true }))
    const { container } = render(<SortableColumn slug="feito">{() => <p>coluna</p>}</SortableColumn>)
    const wrapper = container.firstChild
    expect(wrapper.style.transform).toBe('translate3d(-284px, 0px, 0)')
    expect(wrapper.className).toContain('v3-board-sortable--dragging')
  })
})

describe('DropLine', () => {
  it('is a decoration: hidden from assistive technology and with no content', () => {
    const { container } = render(<ul><DropLine /></ul>)
    const line = container.querySelector('.v3-board-dropline')
    expect(line.getAttribute('aria-hidden')).toBe('true')
    expect(line.textContent).toBe('')
    expect(line.tagName).toBe('LI')
  })
})

describe('BoardOverlay', () => {
  const dragged = card(5, 'Pessoal/tn-sandbox', { titulo: 'Escrever o plano', descricao: 'Três linhas **importantes**', prioridade: 'alta', tipo: 'bug' })

  it('shows nothing when nothing is dragged', () => {
    render(<BoardOverlay />)
    expect(screen.getByTestId('overlay-host').textContent).toBe('')
  })

  it('shows a copy of the card with no control a finger could land on', () => {
    render(<BoardOverlay card={dragged} />)
    const overlay = screen.getByTestId('overlay-host')
    expect(overlay.textContent).toContain('Escrever o plano')
    expect(overlay.textContent).toContain('Três linhas importantes')
    expect(overlay.querySelector('button, select, a, input')).toBeNull()
    expect(overlay.querySelector('.v3-board-overlay')).not.toBeNull()
  })

  it('shows only the header of a column: name, count and the done mark', () => {
    render(<BoardOverlay column={COLUMNS[2]} count={4} />)
    const overlay = screen.getByTestId('overlay-host')
    expect(overlay.textContent).toContain('Feito')
    expect(overlay.textContent).toContain('(4)')
    expect(overlay.textContent).toContain('✓ Concluída')
    expect(overlay.querySelector('button, select')).toBeNull()
    expect(overlay.querySelector('.v3-board-overlay--column')).not.toBeNull()
  })

  it('is mounted on the body, outside whatever holds the board', () => {
    const { container } = render(<div id="board-root"><BoardOverlay card={dragged} /></div>)
    expect(container.querySelector('[data-testid="overlay-host"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="overlay-host"]')).not.toBeNull()
  })

  it('has no return animation for people who ask for less motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    try {
      render(<BoardOverlay card={dragged} />)
      expect(screen.getByTestId('overlay-host').getAttribute('data-drop-animation')).toBe('none')
    } finally {
      delete window.matchMedia
    }
  })

  it('keeps the default return animation otherwise', () => {
    render(<BoardOverlay card={dragged} />)
    expect(screen.getByTestId('overlay-host').getAttribute('data-drop-animation')).toBe('default')
  })
})
