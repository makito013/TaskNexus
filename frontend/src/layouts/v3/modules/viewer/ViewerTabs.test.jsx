import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ViewerTabs, { tabLabel } from './ViewerTabs.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ITEMS = [
  { id: 'a', path: 'docs/plan.md', title: 'plan.md', kind: 'markdown' },
  { id: 'b', path: 'src/app.py', title: 'app.py', kind: 'code', line: 42 },
  { id: 'c', path: 'src/util.py', title: 'util.py', kind: 'code' },
]

function setup(overrides = {}) {
  const props = { items: ITEMS, activeId: 'a', onSelect: vi.fn(), onClose: vi.fn(), ...overrides }
  const view = render(<ViewerTabs {...props} />)
  return { ...props, ...view }
}

describe('ViewerTabs', () => {
  it('labels a code tab with its line, any other with the title, and keeps the path in the tooltip', () => {
    expect(tabLabel(ITEMS[0])).toBe('plan.md')
    expect(tabLabel(ITEMS[1])).toBe('app.py:42')
    expect(tabLabel(ITEMS[2])).toBe('util.py')
    expect(tabLabel({ id: 'x', path: 'a/b/readme.md' })).toBe('readme.md')
    setup()
    const tabs = within(screen.getByRole('tablist', { name: 'Arquivos abertos' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['plan.md', 'app.py:42', 'util.py'])
    expect(tabs[1].getAttribute('title')).toBe('src/app.py')
  })

  it('marks the active tab, with a single tab stop for the keyboard', () => {
    setup({ activeId: 'b' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('the close control is a sibling of the tab, never a button inside a button', () => {
    setup()
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('button')).toBeNull()
      expect(tab.parentElement.closest('button')).toBeNull()
      expect(tab.parentElement.querySelectorAll('button')).toHaveLength(2)
    }
    expect(screen.getByRole('button', { name: 'Fechar app.py:42' })).toBeTruthy()
  })

  it('selects on click and closes by the sibling control', () => {
    const { onSelect, onClose } = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'util.py' }))
    expect(onSelect).toHaveBeenCalledWith('c')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar util.py' }))
    expect(onClose).toHaveBeenCalledWith('c')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('arrows, Home and End move the selection and the focus, wrapping around', () => {
    const { onSelect } = setup({ activeId: 'a' })
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('b')
    expect(document.activeElement).toBe(tabs[1])
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(tabs[1], { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(tabs[0], { key: 'a' })
    expect(onSelect).toHaveBeenCalledTimes(4)
  })

  it('brings the new active tab into view by the strip scrollLeft, never by scrollIntoView', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const geometry = (element, left, width) => {
      Object.defineProperty(element, 'offsetLeft', { configurable: true, value: left })
      Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width })
    }
    const { rerender, onSelect, onClose } = setup({ activeId: 'a' })
    const list = screen.getByRole('tablist')
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 200 })
    list.scrollLeft = 0
    const wrappers = [...list.querySelectorAll('.v3-viewer-tab')]
    geometry(wrappers[0], 0, 150)
    geometry(wrappers[1], 150, 150)
    geometry(wrappers[2], 300, 150)
    rerender(<ViewerTabs items={ITEMS} activeId="c" onSelect={onSelect} onClose={onClose} />)
    expect(list.scrollLeft).toBe(450 - 200)
    rerender(<ViewerTabs items={ITEMS} activeId="a" onSelect={onSelect} onClose={onClose} />)
    expect(list.scrollLeft).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    delete Element.prototype.scrollIntoView
  })

  it('renders an empty strip without tabs when there are no items', () => {
    setup({ items: [], activeId: null })
    expect(screen.getByRole('tablist').children).toHaveLength(0)
  })
})
