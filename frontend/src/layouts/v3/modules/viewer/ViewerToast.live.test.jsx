import { StrictMode, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { ViewerProvider } from '../../../../hooks/viewerState.jsx'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { KEY, Probe, SCOPE, createHarness, probe, viewerItem } from './viewerTestKit.jsx'
import ViewerToast from './ViewerToast.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

const OTHER_KEY = 'Pessoal/tn-sandbox::claude::z9z9z9'
const OTHER_SCOPE = `session:${OTHER_KEY}`

beforeEach(() => {
  clearViewerContentCache()
  window.innerWidth = 1440
  stubFetch([])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const regionToasts = () => [...document.querySelectorAll('.v3-toast')]
// A conversation that is NOT on screen opens a file: the toast is the only sign of it.
const agentOpensElsewhere = (itemId = 'i1', path = 'docs/plan.md') =>
  act(() => {
    probe.actions.receiveOpen(OTHER_KEY, viewerItem({ item_id: itemId, session_key: OTHER_KEY, path, title: null }), false, [])
  })

describe('ViewerToast: an agent opened a file in a conversation that is not on screen', () => {
  it('says who opened what, with a full stop, in an info toast with "Ver" (never an alert)', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    agentOpensElsewhere()

    expect(regionToasts()).toHaveLength(1)
    const [toast] = regionToasts()
    expect(toast.getAttribute('role')).toBe('status')
    expect(toast.querySelector('.v3-toast__text').textContent).toBe('claude abriu plan.md.')
    expect(screen.getByRole('button', { name: 'Ver' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dispensar aviso' })).not.toBeNull()
  })

  it('the toast does not take the focus', async () => {
    renderWithShell(<textarea aria-label="Mensagem" data-testid="composer" />)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const composer = screen.getByTestId('composer')
    composer.focus()

    agentOpensElsewhere()

    expect(regionToasts()).toHaveLength(1)
    expect(document.activeElement).toBe(composer)
  })

  it('goes away by itself after 6 seconds', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    vi.useFakeTimers()

    agentOpensElsewhere()
    act(() => {
      vi.advanceTimersByTime(5900)
    })
    expect(regionToasts()).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(regionToasts()).toHaveLength(0)
  })

  it('"Ver" goes to that conversation, opens the panel on the tab that arrived and clears the count', async () => {
    const openChat = vi.fn()
    renderWithShell(null, { sessions: { openChat } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    agentOpensElsewhere('i1')
    agentOpensElsewhere('i2', 'docs/other.md')
    expect(probe.viewer.unseen[OTHER_SCOPE]).toBe(2)
    expect(regionToasts()).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Ver' })[0])

    expect(openChat).toHaveBeenCalledTimes(1)
    expect(openChat).toHaveBeenCalledWith(OTHER_KEY)
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    expect(probe.viewer.getScope(OTHER_SCOPE).activeId).toBe('i1')
    expect(probe.viewer.unseen[OTHER_SCOPE]).toBe(0)
    expect(regionToasts()).toHaveLength(1) // the one that was clicked is gone, the other one stays
  })

  it('"Ver" asks the chat screen to show the conversation itself (a phone that was on the list)', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const before = probe.shell.chatViewRequest
    agentOpensElsewhere()

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))

    expect(probe.shell.chatViewRequest).toBe(before + 1)
  })

  it('on a phone "Ver" opens the panel in full screen', async () => {
    window.innerWidth = 390
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    agentOpensElsewhere()

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))

    expect(probe.viewer.getSurface('chat')).toEqual({ open: true, fullscreen: true })
  })

  it('three openings stack in order and a fourth pushes the oldest out', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    for (const [index, name] of ['a.md', 'b.md', 'c.md', 'd.md'].entries()) agentOpensElsewhere(`i${index}`, `docs/${name}`)

    expect(regionToasts().map((toast) => toast.querySelector('.v3-toast__text').textContent)).toEqual([
      'claude abriu b.md.',
      'claude abriu c.md.',
      'claude abriu d.md.',
    ])
  })

  it('an opening on the conversation that IS on screen raises no toast', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    act(() => {
      probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'i1' }), false, [])
    })

    expect(regionToasts()).toHaveLength(0)
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })

  it('an opening by the user ("Você") says so', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    act(() => {
      probe.actions.receiveOpen(OTHER_KEY, viewerItem({ item_id: 'u1', session_key: OTHER_KEY, opened_by: 'user', title: null }), false, [])
    })

    expect(regionToasts()[0].querySelector('.v3-toast__text').textContent).toBe('Você abriu plan.md.')
  })
})

describe('ViewerToast: the other toasts of the viewer keep their behaviour', () => {
  it('an error is an alert with the message in pt-BR (the engine\'s own wording is replaced)', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    act(() => probe.actions.showToast('Failed to fetch', 'error'))
    act(() => probe.actions.showToast('Arquivo não encontrado: docs/x.md', 'error'))

    const alerts = screen.getAllByRole('alert')
    expect(alerts.map((alert) => alert.querySelector('.v3-toast__text').textContent)).toEqual([
      'Sem conexão com o servidor. Tente de novo.',
      'Arquivo não encontrado: docs/x.md',
    ])
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
  })

  it('an info message is a status toast with no action', async () => {
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    act(() => probe.actions.showToast('Limite de 15 arquivos abertos. Feche um para abrir outro.'))

    expect(regionToasts()).toHaveLength(1)
    expect(regionToasts()[0].getAttribute('role')).toBe('status')
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
  })

  it('the viewer toast slot is emptied once the toast is shown (the same id is never shown twice)', async () => {
    renderWithShell(null, { strict: true })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    agentOpensElsewhere()

    expect(regionToasts()).toHaveLength(1)
    expect(probe.viewer.toast).toBeNull()
  })
})

describe('ViewerToast: a toast that was already waiting when it mounts', () => {
  // React runs a mounting component's effects twice in development: with a toast already in the slot, a second
  // push would show the same message twice. The toast id is handled once.
  function Mounts() {
    const [shown, setShown] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setShown(true)}>Montar</button>
        {shown ? <ViewerToast localize={(text) => text} requestChatView={() => {}} /> : null}
      </>
    )
  }

  it('shows it once under StrictMode', () => {
    render(
      <StrictMode>
        <ToastHost>
          <ViewerProvider>
            <Probe />
            <Mounts />
          </ViewerProvider>
        </ToastHost>
      </StrictMode>,
    )
    act(() => probe.actions.showToast('Aviso de antes', 'info'))
    expect(document.querySelectorAll('.v3-toast')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Montar' }))

    expect(document.querySelectorAll('.v3-toast')).toHaveLength(1)
    expect(document.querySelector('.v3-toast__text').textContent).toBe('Aviso de antes')
    expect(probe.viewer.toast).toBeNull()
  })
})
