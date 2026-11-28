import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { ChatHarness, KEY, SCOPE, contentBody, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })
const A = viewerItem({ item_id: 'a', path: 'docs/a.md', title: 'a.md' })

beforeEach(() => {
  clearViewerContentCache()
  window.localStorage.clear()
  stubFetch([
    [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method ? jsonResponse({ success: true }) : jsonResponse({ items: [A] }))],
    ['/api/viewer/a/content', jsonResponse(contentBody({ text: '# Alpha' }))],
  ])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open(width) {
  window.innerWidth = width
  renderWithShell(<ChatHarness />)
  await act(async () => {})
  act(() => probe.actions.setOpen('chat', true))
  await act(async () => {})
}
const section = () => screen.getByTestId('chat-section')
const handle = () => screen.getByRole('separator', { name: 'Redimensionar visualizador' })

describe('the dock', () => {
  it('is a third column at 1440 with the drawn width in a custom property, and no grid attributes while closed', async () => {
    window.innerWidth = 1440
    renderWithShell(<ChatHarness />)
    await act(async () => {})
    expect(section().hasAttribute('data-viewer-dock')).toBe(false)
    act(() => probe.actions.setOpen('chat', true))
    expect(section().hasAttribute('data-viewer-dock')).toBe(true)
    expect(section().style.getPropertyValue('--v3-viewer-dock-width')).toBe('420px')
    expect(await screen.findByRole('region', { name: 'Visualizador de arquivos' })).toBeTruthy()
    expect(screen.getByTestId('viewer-dock').parentElement.parentElement).toBe(section())
  })

  it('closing removes the column and the attributes', async () => {
    await open(1440)
    await screen.findByRole('region', { name: 'Visualizador de arquivos' })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualizador' }))
    expect(screen.queryByTestId('viewer-dock')).toBeNull()
    expect(section().hasAttribute('data-viewer-dock')).toBe(false)
  })

  it('folds the list of conversations at 1280 (408 left for the conversation) and keeps it from 1300', async () => {
    await open(1280)
    expect(section().hasAttribute('data-list-collapsed')).toBe(true)
    cleanup()
    await open(1300)
    expect(section().hasAttribute('data-viewer-dock')).toBe(true)
    expect(section().hasAttribute('data-list-collapsed')).toBe(false)
  })

  it('becomes a drawer below 1280 and a full screen below 768', async () => {
    await open(1279)
    expect(section().hasAttribute('data-viewer-dock')).toBe(false)
    expect(screen.getByTestId('viewer-drawer')).toBeTruthy()
    cleanup()
    await open(767)
    expect(document.querySelector('dialog.v3-viewer-fullscreen[open]')).not.toBeNull()
  })

  it('the separator exposes its range and the drawn width, and the handle is a direct child of the column', async () => {
    await open(1440)
    expect(handle().getAttribute('aria-orientation')).toBe('vertical')
    expect(handle().getAttribute('aria-valuemin')).toBe('360')
    expect(handle().getAttribute('aria-valuemax')).toBe('1080')
    expect(handle().getAttribute('aria-valuenow')).toBe('420')
    expect(handle().parentElement).toBe(screen.getByTestId('viewer-dock'))
    expect(handle().getAttribute('tabindex')).toBe('0')
  })

  it('Home goes to the minimum and End to the maximum, saved as the preference; the DRAWN width never exceeds what leaves 420 to the conversation', async () => {
    await open(1440)
    fireEvent.keyDown(handle(), { key: 'Home' })
    expect(window.localStorage.getItem('escritorio:viewer-dock-width')).toBe('360')
    expect(handle().getAttribute('aria-valuenow')).toBe('360')
    expect(section().style.getPropertyValue('--v3-viewer-dock-width')).toBe('360px')
    fireEvent.keyDown(handle(), { key: 'End' })
    expect(window.localStorage.getItem('escritorio:viewer-dock-width')).toBe('1080')
    // 1440 - 148 (shell) - 16 (gap) - 420 (conversation) = 856: the saved 1080 is only the preference.
    expect(section().style.getPropertyValue('--v3-viewer-dock-width')).toBe('856px')
    expect(handle().getAttribute('aria-valuenow')).toBe('856')
  })

  it('a double click goes back to the default width', async () => {
    await open(1440)
    fireEvent.keyDown(handle(), { key: 'Home' })
    fireEvent.doubleClick(handle())
    expect(window.localStorage.getItem('escritorio:viewer-dock-width')).toBeNull()
    expect(handle().getAttribute('aria-valuenow')).toBe('420')
  })

  it('keeps being a dock while the handle is dragged even if the window crosses the limit, and saves on release', async () => {
    await open(1300)
    const grip = handle()
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 900 })
    act(() => {
      window.innerWidth = 700
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
    expect(screen.getByTestId('viewer-dock')).toBeTruthy()
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 800 })
    fireEvent.pointerUp(grip, { pointerId: 1 })
    expect(window.localStorage.getItem('escritorio:viewer-dock-width')).not.toBeNull()
  })

  it('Esc closes only with the focus inside; in the composer it is left alone', async () => {
    await open(1440)
    const panel = await screen.findByRole('region', { name: 'Visualizador de arquivos' })
    screen.getByTestId('composer').focus()
    fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Escape' })
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    fireEvent.keyDown(within(panel).getAllByRole('tab')[0] ?? panel, { key: 'Escape' })
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('a plain Esc typed in the terminal inside the dock is the agent\'s and does not close it', async () => {
    await open(1440)
    const panel = await screen.findByRole('region', { name: 'Visualizador de arquivos' })
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    panel.append(xterm)
    fireEvent.keyDown(xterm, { key: 'Escape' })
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })

  it('the expand button turns the dock into a full screen and keeps the column reserved', async () => {
    await open(1440)
    fireEvent.click(await screen.findByRole('button', { name: 'Tela cheia' }))
    expect(document.querySelector('dialog.v3-viewer-fullscreen[open]')).not.toBeNull()
    expect(section().hasAttribute('data-viewer-dock')).toBe(true)
    expect(within(screen.getByTestId('viewer-dock')).queryByRole('region', { name: 'Visualizador de arquivos' })).toBeNull()
  })

  it('a full screen that came from the phone is switched off when the window grows', async () => {
    await open(600)
    expect(probe.viewer.getSurface('chat').fullscreen).toBe(false)
    act(() => probe.actions.setFullscreen('chat', true))
    act(() => {
      window.innerWidth = 1440
      window.dispatchEvent(new Event('resize'))
    })
    expect(probe.viewer.getSurface('chat').fullscreen).toBe(false)
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })
})
