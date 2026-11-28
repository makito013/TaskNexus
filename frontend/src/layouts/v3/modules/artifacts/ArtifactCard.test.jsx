import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { artifact } from './artifactFixtures.js'
import ArtifactCard from './ArtifactCard.jsx'
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX } from './useLongPress.js'

const row = artifact(1, 'Pessoal/tn-sandbox', { title: 'Relatório Q3', path: 'docs/q3.md', excerpt: 'O trecho do documento.' })

function setup(props = {}) {
  const onOpen = vi.fn()
  const onMenu = vi.fn()
  const view = render(<ArtifactCard artifact={row} onOpen={onOpen} onMenu={onMenu} {...props} />)
  return { ...view, onOpen, onMenu }
}
const opener = () => screen.getByRole('button', { name: /^Relatório Q3/ })
const article = () => screen.getByRole('article')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ArtifactCard: what it shows', () => {
  it('shows the type, the title, the path, the excerpt and who/when/size', () => {
    setup()
    expect(screen.getByText('MD')).toBeTruthy()
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
    expect(screen.getByText('docs/q3.md').getAttribute('title')).toBe('docs/q3.md')
    expect(screen.getByText('O trecho do documento.')).toBeTruthy()
    expect(screen.getByText(/^claude · .* · 2(.0)? KB$/)).toBeTruthy()
  })

  it('the title is the ONE button that opens it, named with the type, and the "⋯" is another', () => {
    setup()
    expect(opener().getAttribute('aria-label')).toBe('Relatório Q3 (MD)')
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Relatório Q3 (MD)', 'Ações de Relatório Q3'])
    // a button never sits inside another
    expect(opener().querySelector('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ações de Relatório Q3' }).getAttribute('aria-haspopup')).toBe('menu')
  })

  it('the open card has a border class AND aria-current, never colour alone', () => {
    setup({ active: true })
    expect(opener().getAttribute('aria-current')).toBe('true')
    expect(article().className).toMatch(/--active/)
    cleanup()
    setup({ active: false })
    expect(opener().getAttribute('aria-current')).toBeNull()
  })

  it('a vanished file says so in words, names it in the button and shows no excerpt', () => {
    setup({ artifact: { ...row, exists: false } })
    expect(screen.getByText('arquivo não encontrado')).toBeTruthy()
    expect(opener().getAttribute('aria-label')).toBe('Relatório Q3 (MD), arquivo não encontrado')
    expect(screen.queryByText('O trecho do documento.')).toBeNull()
  })
})

describe('ArtifactCard: opening and the menu', () => {
  it('a click on the title opens it', () => {
    const { onOpen, onMenu } = setup()
    fireEvent.click(opener())
    expect(onOpen).toHaveBeenCalledWith(row)
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('the "⋯" opens the menu anchored on itself and does not open the card', () => {
    const { onOpen, onMenu } = setup()
    const more = screen.getByRole('button', { name: 'Ações de Relatório Q3' })
    fireEvent.click(more)
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onMenu.mock.calls[0][0]).toBe(row)
    expect(onMenu.mock.calls[0][1].trigger).toBe(more)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('the right button opens the menu at the point of the click, returning to the title', () => {
    const { onOpen, onMenu } = setup()
    // `false` = the default (the browser's own menu) was cancelled
    expect(fireEvent.contextMenu(article(), { clientX: 120, clientY: 80 })).toBe(false)
    expect(onMenu).toHaveBeenCalledTimes(1)
    const { rect, trigger } = onMenu.mock.calls[0][1]
    expect(rect).toEqual({ top: 80, bottom: 80, left: 120, right: 120 })
    expect(trigger).toBe(opener())
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a press held for 500 ms inside 10 px opens the menu at the touch point', () => {
    const { onMenu } = setup()
    // 500 ms and 10 px are the spec (05 section 4.4): literals here, not the constants under test
    expect([LONG_PRESS_MS, MOVE_TOLERANCE_PX]).toEqual([500, 10])
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 50, clientY: 60 })
    act(() => { vi.advanceTimersByTime(499) })
    expect(onMenu).not.toHaveBeenCalled()
    fireEvent.pointerMove(article(), { pointerType: 'touch', clientX: 60, clientY: 60 })
    act(() => { vi.advanceTimersByTime(1) })
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onMenu.mock.calls[0][1].rect).toEqual({ top: 60, bottom: 60, left: 50, right: 50 })
    expect(onMenu.mock.calls[0][1].trigger).toBe(opener())
  })

  it('tells the tab that the menu came from a long press, and not when it came from the right button', () => {
    const { onMenu } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 50, clientY: 60 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
    expect(onMenu.mock.calls[0][1].viaLongPress).toBe(true)
    fireEvent.contextMenu(article(), { clientX: 5, clientY: 6 })
    expect(onMenu.mock.calls[1][1].viaLongPress).toBeUndefined()
  })

  it('a finger that moves more than 10 px is scrolling the list: no menu', () => {
    const { onMenu } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 50, clientY: 60 })
    fireEvent.pointerMove(article(), { pointerType: 'touch', clientX: 50, clientY: 71 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2) })
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('lifting early, leaving the card or a cancelled pointer ends the press', () => {
    const { onMenu } = setup()
    for (const end of ['pointerUp', 'pointerLeave', 'pointerCancel']) {
      fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 1, clientY: 1 })
      act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 10) })
      fireEvent[end](article(), { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
    }
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('a mouse press with a button other than the left one is not a long press', () => {
    const { onMenu } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'mouse', button: 2, clientX: 1, clientY: 1 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2) })
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('the click that the browser sends when the long press ends is swallowed ONCE, the next one opens', () => {
    const { onOpen, onMenu } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 5, clientY: 5 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
    expect(onMenu).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(article(), { pointerType: 'touch' })
    fireEvent.click(opener())
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(opener())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a click long after a long press (nothing came residual) is not swallowed', () => {
    const { onOpen } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 5, clientY: 5 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
    fireEvent.pointerUp(article(), { pointerType: 'touch' })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.click(opener())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a press on the "⋯" never starts a long press', () => {
    const { onMenu } = setup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Ações de Relatório Q3' }), { pointerType: 'touch', clientX: 1, clientY: 1 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2) })
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('unmounting during a press fires nothing', () => {
    const { onMenu, unmount } = setup()
    fireEvent.pointerDown(article(), { pointerType: 'touch', clientX: 1, clientY: 1 })
    unmount()
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2) })
    expect(onMenu).not.toHaveBeenCalled()
  })
})
