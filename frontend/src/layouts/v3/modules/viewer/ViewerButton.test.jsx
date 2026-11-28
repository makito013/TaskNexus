import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { KEY, SCOPE, createHarness, probe, viewerItem } from './viewerTestKit.jsx'
import ViewerButton from './ViewerButton.jsx'

const { stubFetch, renderWithShell } = createHarness({ vi, render })

beforeEach(() => {
  clearViewerContentCache()
  stubFetch([])
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const button = () => screen.getByRole('button', { name: /^Visualizador de arquivos/ })

describe('ViewerButton', () => {
  it('renders nothing without the viewer shell', () => {
    const { container } = render(<ViewerButton scope={SCOPE} />)
    expect(container.firstChild).toBeNull()
  })

  it('is a toggle with aria-pressed that opens and closes the chat panel', async () => {
    renderWithShell(<ViewerButton sessionKey={KEY} />)
    await act(async () => {})
    expect(button().getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button())
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    expect(button().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button())
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('names the tabs and the new ones, and shows the count as the seal', async () => {
    renderWithShell(<ViewerButton sessionKey={KEY} />)
    await act(async () => {})
    expect(button().getAttribute('aria-label')).toBe('Visualizador de arquivos')
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'a' })))
    act(() => probe.actions.setOpen('chat', false))
    expect(button().getAttribute('aria-label')).toBe('Visualizador de arquivos, 1 aba')
    expect(button().textContent).toContain('1')
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'b', path: 'docs/b.md' })))
    act(() => probe.actions.setOpen('chat', false))
    expect(button().getAttribute('aria-label')).toBe('Visualizador de arquivos, 2 abas')
  })

  it('shows the arrivals out of view as TEXT in the fin accent, never only as colour', async () => {
    renderWithShell(<ViewerButton sessionKey={KEY} />)
    await act(async () => {})
    act(() => probe.shell.setChatContentVisible(false))
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'a' })))
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'b', path: 'docs/b.md' })))
    expect(button().getAttribute('aria-label')).toBe('Visualizador de arquivos, 2 abas, 2 novas')
    expect(button().textContent).toContain('2 novos')
    expect(button().querySelector('.v3-chip--accent-fin')).not.toBeNull()
    fireEvent.click(button())
    expect(button().getAttribute('aria-label')).toBe('Visualizador de arquivos, 2 abas')
  })

  it('without a conversation it is aria-disabled with the reason, reachable and inert', async () => {
    renderWithShell(<ViewerButton sessionKey={null} />)
    await act(async () => {})
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(button().hasAttribute('disabled')).toBe(false)
    expect(button().hasAttribute('aria-pressed')).toBe(false)
    const hint = document.getElementById(button().getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('Abra uma conversa para ver arquivos do projeto.')
    fireEvent.click(button())
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('a button disabled by the screen behaves the same', async () => {
    renderWithShell(<ViewerButton sessionKey={KEY} disabled />)
    await act(async () => {})
    fireEvent.click(button())
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('opening it asks for the panel focus, closing it does not', async () => {
    renderWithShell(<ViewerButton sessionKey={KEY} />)
    await act(async () => {})
    fireEvent.click(button())
    expect(probe.shell.consumePanelFocus()).toBe(true)
    fireEvent.click(button())
    expect(probe.shell.consumePanelFocus()).toBe(false)
  })
})
