import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../../hooks/useViewerContent.js'
import { openWebLink } from '../../../../../utils/filePathLinks.js'
import { KEY as CHAT_KEY, callsTo, createHarness, jsonResponse, viewerItem } from '../../viewer/viewerTestKit.jsx'

installDialogElementStub()

const surface = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../../../../terminal/useTerminalSurface.js', () => ({
  useTerminalSurface: (options) => {
    surface.calls.push(options)
    return { status: 'open', sendControlByte: () => {}, focus: () => {}, termRef: { current: null } }
  },
}))

import TerminalFrame from './TerminalFrame.jsx'

const { stubFetch, renderWithShell } = createHarness({ vi, render })

const KEY = 'Pessoal/tn-sandbox::codex::ab12cd'
const lastOptions = () => surface.calls.at(-1)
// A terminal double that holds one buffer line, as the link provider reads it.
const termWith = (line) => ({ buffer: { active: { getLine: () => ({ translateToString: () => line }) } } })
const linksOf = (provider, line = 'erro em src/app.py:42 ok') =>
  new Promise((resolve) => provider.provideLinks(1, resolve)).then((links) => links ?? [])
const providerOf = (options, line) => options.linkProviders[0](termWith(line))
const okPost = (path) => jsonResponse({ success: true, item: viewerItem({ item_id: 'n1', path }), reused: false, evicted: [], delivered: false })

beforeEach(() => {
  surface.calls.length = 0
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TerminalFrame: web links', () => {
  it('always hands the hook the safe handler (no opener), with and without the viewer shell', () => {
    render(<TerminalFrame sessionKey={KEY} agentName="Codex" />)
    expect(lastOptions().onOpenLink).toBe(openWebLink)
    cleanup()
    stubFetch([])
    renderWithShell(<TerminalFrame sessionKey={KEY} agentName="Codex" />)
    expect(lastOptions().onOpenLink).toBe(openWebLink)
  })

  it('openWebLink opens a new tab with noopener and noreferrer and leaves no opener behind', () => {
    const popup = { opener: 'the app window' }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)
    const event = { preventDefault: vi.fn() }

    render(<TerminalFrame sessionKey={KEY} agentName="Codex" />)
    lastOptions().onOpenLink(event, 'https://example.com/a')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
    expect(popup.opener).toBeNull()
  })
})

describe('TerminalFrame: file links', () => {
  it('gives the hook ONE provider factory, and the same one on every render (the terminal is never rebuilt for it)', () => {
    const view = render(<TerminalFrame sessionKey={KEY} agentName="Codex" />)
    const first = lastOptions().linkProviders
    expect(first).toHaveLength(1)
    expect(typeof first[0]).toBe('function')

    view.rerender(<TerminalFrame sessionKey={KEY} agentName="Codex" folderLabel="Outro" failed />)

    expect(surface.calls.length).toBeGreaterThan(1)
    expect(lastOptions().linkProviders).toBe(first)
    expect(lastOptions().onOpenLink).toBe(openWebLink)
  })

  it('without the viewer shell (an isolated terminal) nothing is underlined', async () => {
    render(<TerminalFrame sessionKey={KEY} agentName="Codex" />)

    expect(await linksOf(providerOf(lastOptions()))).toEqual([])
  })

  it('with the shell it underlines the path of a line, with the xterm range, and the click opens it at that line', async () => {
    const fetchMock = stubFetch([[`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST' ? okPost('src/app.py') : jsonResponse({ items: [] }))]])
    renderWithShell(<TerminalFrame sessionKey={KEY} agentName="Codex" />, { activeSessionKey: CHAT_KEY })

    const links = await linksOf(providerOf(lastOptions(), 'erro em src/app.py:42 ok'))

    expect(links).toHaveLength(1)
    expect(links[0].text).toBe('src/app.py:42')
    expect(links[0].range).toEqual({ start: { x: 9, y: 1 }, end: { x: 21, y: 1 } })
    expect(links[0].decorations).toEqual({ underline: true, pointerCursor: true })
    links[0].activate()

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST')[0][0]).toBe(`/api/sessions/${KEY}/viewer`)
    expect(JSON.parse(callsTo(fetchMock, 'POST')[0][1].body)).toEqual({ caminho: 'src/app.py', linha: 42 })
  })

  it('a path with no line opens with no line', async () => {
    const fetchMock = stubFetch([[`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST' ? okPost('docs/plano.md') : jsonResponse({ items: [] }))]])
    renderWithShell(<TerminalFrame sessionKey={KEY} agentName="Codex" />, { activeSessionKey: CHAT_KEY })

    const [link] = await linksOf(providerOf(lastOptions(), 'veja docs/plano.md'))
    link.activate()

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(JSON.parse(callsTo(fetchMock, 'POST')[0][1].body)).toEqual({ caminho: 'docs/plano.md' })
  })

  it('a URL, a folder and a version in the line are not links', async () => {
    stubFetch([])
    renderWithShell(<TerminalFrame sessionKey={KEY} agentName="Codex" />, { activeSessionKey: CHAT_KEY })

    expect(await linksOf(providerOf(lastOptions(), 'https://x.test/a/b.py:3 e pasta docs/ e v1.2'))).toEqual([])
  })
})
