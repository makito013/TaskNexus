import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import FileLinkScope from '../viewer/FileLinkScope.jsx'
import { KEY, callsTo, createHarness, jsonResponse, viewerItem } from '../viewer/viewerTestKit.jsx'
import AgentBubble from './bubbles/AgentBubble.jsx'
import PermissionCard from './PermissionCard.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

const TEXT = 'Editei src/app.py:42 e `docs/plano.md`. Veja https://github.com/org/repo/README.md e a versão v1.2.'
const message = (overrides = {}) => ({ id: 'm1', parts: [{ type: 'text', text: TEXT }], ...overrides })
const bubble = (props = {}) => (
  <FileLinkScope sessionKey={KEY}>
    <AgentBubble message={message()} agentName="Claude" toolsById={{}} {...props} />
  </FileLinkScope>
)
const pathButtons = () => screen.queryAllByRole('button', { name: /no visualizador/ })
const okPost = jsonResponse({ success: true, item: viewerItem({ item_id: 'n1', path: 'src/app.py' }), reused: false, evicted: [], delivered: false })
const postRoute = [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST' ? okPost : jsonResponse({ items: [] }))]

beforeEach(() => {
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AgentBubble with file links', () => {
  it('turns the paths of a final message into buttons and leaves a URL and a version as text', () => {
    stubFetch([])
    renderWithShell(bubble())

    expect(pathButtons().map((button) => button.getAttribute('data-file-path'))).toEqual(['src/app.py', 'docs/plano.md'])
    const text = document.querySelector('.v3-chat-bubble--agent').textContent
    expect(text).toContain('https://github.com/org/repo/README.md')
    expect(text).toContain('v1.2')
  })

  it('a click on the path opens it in the viewer of THIS conversation, at the line', async () => {
    const fetchMock = stubFetch([postRoute])
    renderWithShell(bubble())

    fireEvent.click(screen.getByRole('button', { name: 'Abrir src/app.py:42 no visualizador' }))

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST')[0][0]).toBe(`/api/sessions/${KEY}/viewer`)
    expect(JSON.parse(callsTo(fetchMock, 'POST')[0][1].body)).toEqual({ caminho: 'src/app.py', linha: 42 })
  })

  it('a bubble that is still streaming has no buttons', () => {
    stubFetch([])
    renderWithShell(bubble({ message: message({ streaming: true }) }))

    expect(pathButtons()).toHaveLength(0)
    expect(document.querySelector('.v3-chat-bubble--agent').textContent).toContain('src/app.py:42')
  })

  it('without the viewer shell (an isolated bubble) the text is exactly what it was', () => {
    render(<AgentBubble message={message()} agentName="Claude" toolsById={{}} />)

    expect(pathButtons()).toHaveLength(0)
    expect(document.querySelector('.v3-chat-bubble--agent').textContent).toContain('src/app.py:42')
    expect(document.querySelector('.v3-chat-bubble--agent button')).toBeNull()
  })

  it('without a scope around it (the shell is there, the conversation is not) there are no buttons either', () => {
    stubFetch([])
    renderWithShell(<AgentBubble message={message()} agentName="Claude" toolsById={{}} />)

    expect(pathButtons()).toHaveLength(0)
  })

  it('every text bubble of the message gets them, across the runs', () => {
    stubFetch([])
    const parts = [
      { type: 'text', text: 'Primeiro a.md' },
      { type: 'tool', toolUseId: 't1' },
      { type: 'text', text: 'Depois b/c.ts' },
    ]
    renderWithShell(bubble({
      message: message({ parts }),
      toolsById: { t1: { id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'done' } },
    }))

    expect(pathButtons().map((button) => button.getAttribute('data-file-path'))).toEqual(['a.md', 'b/c.ts'])
  })

  it('the interactive parts do not nest: no button inside a button, none inside a summary', () => {
    stubFetch([])
    renderWithShell(bubble())

    expect(document.querySelector('button button')).toBeNull()
    expect(document.querySelector('summary button, summary a')).toBeNull()
  })
})

describe('what is NOT decorated: cards that sit next to an approval button', () => {
  const PLAN = { id: 'p1', kind: 'plan', status: 'pending', input: { plan: '1. Editar src/app.py:42\n2. Ler [o plano](docs/plano.md)' } }

  it('the plan of the permission card has no path buttons, even inside the scope', () => {
    stubFetch([])
    renderWithShell(
      <FileLinkScope sessionKey={KEY}>
        <PermissionCard card={PLAN} agentName="Claude" context="p" decision={undefined} onDecide={() => {}} />
      </FileLinkScope>,
    )

    expect(pathButtons()).toHaveLength(0)
    expect(screen.getByRole('region', { name: 'Plano proposto' }).textContent).toContain('src/app.py:42')
  })

  it('a click on a relative link inside the plan is not intercepted (nothing is opened)', () => {
    const fetchMock = stubFetch([postRoute])
    renderWithShell(
      <FileLinkScope sessionKey={KEY}>
        <PermissionCard card={PLAN} agentName="Claude" context="p" decision={undefined} onDecide={() => {}} />
      </FileLinkScope>,
    )

    const record = (event) => event.preventDefault() // keeps jsdom from navigating
    document.addEventListener('click', record)
    fireEvent.click(screen.getByRole('link', { name: 'o plano' }))
    document.removeEventListener('click', record)

    expect(callsTo(fetchMock, 'POST')).toHaveLength(0)
  })
})
