import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import MarkdownBody from '../chat/MarkdownBody.jsx'
import FileLinkScope, { useFileLinks } from './FileLinkScope.jsx'
import { KEY, callsTo, createHarness, jsonResponse, viewerItem } from './viewerTestKit.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

let seen
function Capture() {
  seen = useFileLinks()
  return null
}

// What the agent's text does with the scope: the rendered markdown wired to `useFileLinks()`, like AgentBubble.
function Text({ text, ...props }) {
  const fileLinks = useFileLinks()
  return <MarkdownBody text={text} fileLinks={fileLinks} {...props} />
}

// A message that streams and then ends: the button "Terminar" flips `highlight`, the signal of a final message.
function StreamingThenFinal({ text }) {
  const [streaming, setStreaming] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setStreaming(false)}>Terminar</button>
      <Text text={text} highlight={!streaming} />
    </>
  )
}

const postBody = (fetchMock) => JSON.parse(callsTo(fetchMock, 'POST').at(-1)[1].body)
const okPost = (path = 'src/app.py') =>
  jsonResponse({ success: true, item: viewerItem({ item_id: 'n1', path }), reused: false, evicted: [], delivered: false })
const postRoute = (path) => [
  `/api/sessions/${KEY}/viewer`,
  (_url, init) => (init?.method === 'POST' ? okPost(path) : jsonResponse({ items: [] })),
]
const pathButtons = () => screen.queryAllByRole('button', { name: /no visualizador/ })

beforeEach(() => {
  seen = undefined
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FileLinkScope', () => {
  it('answers null outside the viewer shell and outside a scope', () => {
    render(<FileLinkScope sessionKey={KEY}><Capture /></FileLinkScope>)
    expect(seen).toBeNull()
    cleanup()
    render(<Capture />)
    expect(seen).toBeNull()
  })

  it('answers null with no conversation, even inside the shell', () => {
    stubFetch([])
    renderWithShell(<FileLinkScope sessionKey={null}><Capture /></FileLinkScope>)
    expect(seen).toBeNull()
  })

  it('inside the shell gives openPath, which POSTs the path and the line to the viewer of that conversation', async () => {
    const fetchMock = stubFetch([postRoute('src/app.py')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Capture /></FileLinkScope>)

    const result = await seen.openPath('src/app.py', { line: 42 })

    expect(result.ok).toBe(true)
    expect(postBody(fetchMock)).toEqual({ caminho: 'src/app.py', linha: 42 })
    expect(callsTo(fetchMock, 'POST').at(-1)[0]).toBe(`/api/sessions/${KEY}/viewer`)
  })

  it('openPath without a line sends none', async () => {
    const fetchMock = stubFetch([postRoute('docs/a.md')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Capture /></FileLinkScope>)

    await seen.openPath('docs/a.md')

    expect(postBody(fetchMock)).toEqual({ caminho: 'docs/a.md' })
  })

  it('a key that is not safe opens nothing and says so', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(<FileLinkScope sessionKey="P/../x::claude::y"><Capture /></FileLinkScope>, { activeSessionKey: null })

    const result = await seen.openPath('a.md')

    expect(result.ok).toBe(false)
    expect(callsTo(fetchMock, 'POST')).toHaveLength(0)
  })
})

describe('the text of a message inside the scope', () => {
  const TEXT = 'Veja `src/app.py:42`, docs/plano.md e [o plano](docs/plano.md#L3), [topo](#topo), [site](https://x.com/a.md).'

  it('a click on a path button opens the file at its line and does not follow anything', async () => {
    const fetchMock = stubFetch([postRoute('src/app.py')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text={TEXT} /></FileLinkScope>)

    const button = screen.getByRole('button', { name: 'Abrir src/app.py:42 no visualizador' })
    expect(fireEvent.click(button)).toBe(false) // preventDefault was called

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(postBody(fetchMock)).toEqual({ caminho: 'src/app.py', linha: 42 })
  })

  it('a path in plain text is a real button, and its click opens the file with no line', async () => {
    const fetchMock = stubFetch([postRoute('docs/plano.md')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text={TEXT} /></FileLinkScope>)

    const button = screen.getByRole('button', { name: 'Abrir docs/plano.md no visualizador' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    fireEvent.click(button)

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(postBody(fetchMock)).toEqual({ caminho: 'docs/plano.md' })
  })

  it('a relative link opens in the viewer (with its #L fragment) and does not navigate', async () => {
    const fetchMock = stubFetch([postRoute('docs/plano.md')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text={TEXT} /></FileLinkScope>)

    expect(fireEvent.click(screen.getByRole('link', { name: 'o plano' }))).toBe(false)

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(postBody(fetchMock)).toEqual({ caminho: 'docs/plano.md#L3' })
  })

  it('an #anchor and an external link are not ours: the click is not prevented and nothing is opened', () => {
    const fetchMock = stubFetch([])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text={TEXT} /></FileLinkScope>)
    const external = screen.getByRole('link', { name: 'site' })
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')

    // A document listener records whether anything before it already cancelled the click, and cancels it
    // itself so that jsdom does not try to navigate.
    const seenPrevented = []
    const record = (event) => {
      seenPrevented.push(event.defaultPrevented)
      event.preventDefault()
    }
    document.addEventListener('click', record)
    fireEvent.click(screen.getByRole('link', { name: 'topo' }))
    fireEvent.click(external)
    document.removeEventListener('click', record)

    expect(seenPrevented).toEqual([false, false])
    expect(callsTo(fetchMock, 'POST')).toHaveLength(0)
  })

  it('a message that is still streaming has no buttons, and gets them when it becomes final', () => {
    stubFetch([])
    renderWithShell(<FileLinkScope sessionKey={KEY}><StreamingThenFinal text={TEXT} /></FileLinkScope>)
    expect(pathButtons()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Terminar' }))

    expect(pathButtons().map((button) => button.getAttribute('data-file-path'))).toEqual(['src/app.py', 'docs/plano.md'])
  })

  it('text shown as text (the plan: rawHtmlAsText) gets no buttons even inside the scope', () => {
    stubFetch([])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text={TEXT} rawHtmlAsText /></FileLinkScope>)

    expect(pathButtons()).toHaveLength(0)
  })

  it('a MarkdownBody with no fileLinks renders exactly the HTML of the chat and ignores clicks', () => {
    const fetchMock = stubFetch([])
    renderWithShell(<MarkdownBody text={TEXT} />)

    expect(pathButtons()).toHaveLength(0)
    const record = (event) => event.preventDefault()
    document.addEventListener('click', record)
    fireEvent.click(screen.getByRole('link', { name: 'o plano' }))
    document.removeEventListener('click', record)
    expect(callsTo(fetchMock, 'POST')).toHaveLength(0)
  })

  it('opening a file the server refuses shows its message as an alert toast', async () => {
    stubFetch([[`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST'
      ? jsonResponse({ success: false, error: 'Arquivo não encontrado: src/app.py' }, 404)
      : jsonResponse({ items: [] }))]])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text="Veja src/app.py" /></FileLinkScope>)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir src/app.py no visualizador' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Arquivo não encontrado: src/app.py')
  })

  it('two quick clicks on the same path are one request', async () => {
    const fetchMock = stubFetch([postRoute('src/app.py')])
    renderWithShell(<FileLinkScope sessionKey={KEY}><Text text="Veja src/app.py" /></FileLinkScope>)
    const button = screen.getByRole('button', { name: 'Abrir src/app.py no visualizador' })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
  })
})
