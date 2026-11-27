import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import Dialog from '../../components/Dialog/Dialog.jsx'
import { ChatHarness, KEY, contentBody, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'
import ViewerButton from './ViewerButton.jsx'

installDialogElementStub()
const { stubFetch, renderWithShell } = createHarness({ vi, render })
const A = viewerItem({ item_id: 'a', path: 'docs/a.md', title: 'a.md' })

beforeEach(() => {
  clearViewerContentCache()
  window.innerWidth = 1100
  stubFetch([
    [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method ? jsonResponse({ success: true }) : jsonResponse({ items: [A] }))],
    ['/api/viewer/a/content', jsonResponse(contentBody({ text: '# Alpha' }))],
  ])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const drawer = () => screen.getByTestId('viewer-drawer')
async function mount(extra = null, props = {}) {
  renderWithShell(
    <>
      <ChatHarness {...props} />
      {extra}
    </>,
  )
  await act(async () => {})
}

describe('the drawer', () => {
  it('is a portal into <body> with a fixed panel and scrim, declared inline', async () => {
    await mount()
    act(() => probe.actions.setOpen('chat', true))
    await screen.findByRole('complementary', { name: 'Visualizador de arquivos' })
    expect(drawer().parentElement).toBe(document.body)
    expect(drawer().firstChild.style.position).toBe('fixed')
    expect(screen.getByTestId('viewer-drawer-scrim').style.position).toBe('fixed')
  })

  it('a click on the scrim closes it', async () => {
    await mount()
    act(() => probe.actions.setOpen('chat', true))
    fireEvent.click(screen.getByTestId('viewer-drawer-scrim'))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
  })

  it('Esc closes only with the focus inside it, and never reaches the panel of the chat (it would interrupt the turn)', async () => {
    const onPanelKeyDown = vi.fn()
    await mount(null, { onPanelKeyDown })
    act(() => probe.actions.setOpen('chat', true))
    const region = await screen.findByRole('complementary', { name: 'Visualizador de arquivos' })
    fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Escape' })
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    onPanelKeyDown.mockClear()
    fireEvent.keyDown(region, { key: 'Escape' })
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(onPanelKeyDown).not.toHaveBeenCalled()
  })

  it('opened by a file that arrives by itself, it does NOT take the focus from the composer', async () => {
    await mount()
    screen.getByTestId('composer').focus()
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'b', path: 'docs/b.md', title: 'b.md' })))
    await screen.findByRole('complementary', { name: 'Visualizador de arquivos' })
    await act(async () => {})
    expect(document.activeElement).toBe(screen.getByTestId('composer'))
  })

  it('opened by the button (a gesture) it focuses the active tab, and closing by the keyboard gives the focus back', async () => {
    await mount(<ViewerButton sessionKey={KEY} />)
    const button = screen.getByRole('button', { name: /^Visualizador de arquivos/ })
    button.focus()
    fireEvent.click(button)
    const tab = await screen.findByRole('tab', { name: 'a.md' })
    await act(async () => {})
    expect(document.activeElement).toBe(tab)
    fireEvent.keyDown(tab, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Visualizador de arquivos/ }))
  })

  it('closing does NOT pull the focus back when the person already moved to the composer', async () => {
    await mount(<ViewerButton sessionKey={KEY} />)
    const button = screen.getByRole('button', { name: /^Visualizador de arquivos/ })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole('tab', { name: 'a.md' })
    screen.getByTestId('composer').focus()
    fireEvent.click(screen.getByTestId('viewer-drawer-scrim'))
    expect(document.activeElement).toBe(screen.getByTestId('composer'))
  })

  it('the expand button hands over to the full screen', async () => {
    await mount()
    act(() => probe.actions.setOpen('chat', true))
    fireEvent.click(await screen.findByRole('button', { name: 'Tela cheia' }))
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
    expect(document.querySelector('dialog.v3-viewer-fullscreen[open]')).not.toBeNull()
  })

  it('an opening that finds a modal on screen waits for it: the tab and the seal update at once, the drawer appears when it closes', async () => {
    function Sheet() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>sheet-close</button>
          <Dialog open={open} title="Aprovar" titleId="t" onClose={() => setOpen(false)}><p>Permitir?</p></Dialog>
        </>
      )
    }
    await mount(<Sheet />)
    act(() => probe.actions.setOpen('chat', true))
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'c', path: 'docs/c.md', title: 'c.md' })))
    expect(probe.viewer.getScope(`session:${KEY}`).items.some((item) => item.id === 'c')).toBe(true)
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
    fireEvent.keyDown(screen.getByText('Permitir?'), { key: 'Escape' })
    expect(await screen.findByTestId('viewer-drawer')).toBeTruthy()
  })

  it('a modal that arrives while the drawer is already drawn does not make it disappear', async () => {
    function LateSheet() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>sheet-open</button>
          <Dialog open={open} title="Aprovar" titleId="late" onClose={() => setOpen(false)}><p>Permitir?</p></Dialog>
        </>
      )
    }
    await mount(<LateSheet />)
    act(() => probe.actions.setOpen('chat', true))
    expect(await screen.findByTestId('viewer-drawer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'sheet-open' }))
    await screen.findByText('Permitir?')
    expect(screen.getByTestId('viewer-drawer')).toBeTruthy()
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })
})
