import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { topModal } from '../../components/Dialog/modalStack.js'
import Dialog from '../../components/Dialog/Dialog.jsx'
import { ChatHarness, KEY, contentBody, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'

installDialogElementStub()
const { stubFetch, renderWithShell } = createHarness({ vi, render })
const A = viewerItem({ item_id: 'a', path: 'docs/a.md', title: 'a.md' })

beforeEach(() => {
  resetDialogElementStubState()
  clearViewerContentCache()
  window.innerWidth = 600
  stubFetch([
    [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method ? jsonResponse({ success: true }) : jsonResponse({ items: [A] }))],
    ['/api/viewer/a/content', jsonResponse(contentBody({ text: '# Alpha' }))],
  ])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fullscreen = () => document.querySelector('dialog.v3-viewer-fullscreen')

async function mount(extra = null, options = {}) {
  renderWithShell(
    <>
      <ChatHarness />
      {extra}
    </>,
    options,
  )
  await act(async () => {})
  act(() => probe.actions.setOpen('chat', true))
  await screen.findByRole('region', { name: 'Visualizador de arquivos' })
}

describe('the full screen', () => {
  it('is a <dialog> of its own opened with showModal, portalled into <body>, with the panel inside', async () => {
    await mount()
    expect(fullscreen().open).toBe(true)
    expect(fullscreen().parentElement).toBe(document.body)
    expect(within(fullscreen()).getByRole('region', { name: 'Visualizador de arquivos' })).toBeTruthy()
    expect(fullscreen().getAttribute('aria-label')).toBe('Visualizador em tela cheia')
    expect(topModal()).toBe(fullscreen())
  })

  it('"✕ Fechar" on a phone closes the whole viewer and releases the modal stack', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '✕ Fechar' }))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(fullscreen()).toBeNull()
    expect(topModal()).toBeNull()
  })

  it('Esc is refused by `cancel` and closes the viewer exactly once', async () => {
    await mount()
    const dialog = fullscreen()
    const cancel = new Event('cancel', { cancelable: true, bubbles: true })
    act(() => { dialog.dispatchEvent(cancel) })
    expect(cancel.defaultPrevented).toBe(true)
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('a native `close` that skipped `cancel` (a second Esc) still closes the viewer', async () => {
    await mount()
    act(() => fullscreen().dispatchEvent(new Event('close')))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('on a tablet the expand button gives a full screen that leaves back to the panel, not to nothing', async () => {
    window.innerWidth = 1100
    renderWithShell(<ChatHarness />)
    await act(async () => {})
    act(() => probe.actions.setOpen('chat', true))
    fireEvent.click(await screen.findByRole('button', { name: 'Tela cheia' }))
    expect(fullscreen().open).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '✕ Fechar' }))
    expect(probe.viewer.getSurface('chat')).toEqual({ open: true, fullscreen: false })
    expect(fullscreen()).toBeNull()
    expect(screen.getByTestId('viewer-drawer')).toBeTruthy()
  })

  it('opened over a modal on purpose (a card attachment) it is not drawn inside another dialog: it is a sibling of the one under it, and its Esc does not reach it', async () => {
    const onClose = vi.fn()
    window.innerWidth = 1100
    renderWithShell(
      <>
        <ChatHarness ignoreModals />
        <Dialog open title="Card" titleId="card" onClose={onClose}><p>corpo</p></Dialog>
      </>,
    )
    await act(async () => {})
    act(() => probe.actions.setFullscreen('chat', true))
    await screen.findByRole('region', { name: 'Visualizador de arquivos' })
    const dialogs = [...document.querySelectorAll('dialog')]
    expect(dialogs).toHaveLength(2)
    expect(dialogs.every((dialog) => dialog.parentElement === document.body || !dialog.parentElement.closest('dialog'))).toBe(true)
    expect(fullscreen().closest('dialog:not(.v3-viewer-fullscreen)')).toBeNull()
    // The viewer is on top, even though it was opened over a modal ("the viewer of a card attachment" case).
    expect(topModal()).toBe(fullscreen())
    act(() => fullscreen().dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a toast shows INSIDE the full screen (everything behind a modal is inert)', async () => {
    await mount()
    act(() => probe.actions.showToast('Falhou.', 'error'))
    const alert = await screen.findByRole('alert')
    expect(fullscreen().contains(alert)).toBe(true)
  })

  it('does not close itself when React runs the effects twice (StrictMode)', async () => {
    window.innerWidth = 600
    renderWithShell(<ChatHarness />, { strict: true })
    await act(async () => {})
    act(() => probe.actions.setOpen('chat', true))
    await screen.findByRole('region', { name: 'Visualizador de arquivos' })
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    expect(document.querySelectorAll('dialog.v3-viewer-fullscreen[open]')).toHaveLength(1)
    expect(StrictMode).toBeTruthy()
  })

  it('when something else asks for the stack the viewer does not collapse by itself (its own dialog is not "another modal")', async () => {
    await mount()
    await act(async () => {})
    expect(fullscreen().open).toBe(true)
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })
})
