import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../../hooks/useViewerContent.js'
import FileLinkScope from '../../viewer/FileLinkScope.jsx'
import { KEY, callsTo, createHarness, jsonResponse, viewerItem } from '../../viewer/viewerTestKit.jsx'
import ToolChip from './ToolChip.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

const tool = (name, input, extra = {}) => ({ id: `t-${name}`, name, input, status: 'done', ...extra })
const chip = (t) => (
  <FileLinkScope sessionKey={KEY}>
    <ToolChip tool={t} />
  </FileLinkScope>
)
const openButton = () => screen.queryByRole('button', { name: /^Abrir .+ no visualizador$/ })
const okPost = jsonResponse({ success: true, item: viewerItem({ item_id: 'n1' }), reused: false, evicted: [], delivered: false })
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

describe('ToolChip: "Abrir arquivo"', () => {
  it.each([
    ['Read', { file_path: 'src/app.py' }],
    ['Edit', { file_path: 'src/app.py', old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: 'src/app.py', edits: [{ old_string: 'a', new_string: 'b' }] }],
    ['Write', { file_path: 'src/app.py', content: 'x' }],
  ])('a %s chip with a file has the button, inside the detail and outside the summary', (name, input) => {
    stubFetch([])
    renderWithShell(chip(tool(name, input)))

    const button = openButton()
    expect(button).not.toBeNull()
    expect(button.closest('summary')).toBeNull()
    expect(button.closest('.v3-chat-chip__detail')).not.toBeNull()
    expect(document.querySelector('summary button')).toBeNull()
  })

  it('the button names its file for a screen reader (CV-25) while the visible text stays "Abrir arquivo"', () => {
    stubFetch([])
    renderWithShell(chip(tool('Read', { file_path: 'src/app.py' })))

    const button = screen.getByRole('button', { name: 'Abrir src/app.py no visualizador' })
    expect(button.getAttribute('aria-label')).toBe('Abrir src/app.py no visualizador')
    expect(button.textContent).toBe('Abrir arquivo')
  })

  it.each([
    ['a shell command', tool('Bash', { command: 'cat src/app.py' })],
    ['PowerShell', tool('PowerShell', { command: 'type src/app.py' })],
    ['a search', tool('Grep', { pattern: 'app' })],
    ['a web search', tool('WebSearch', { query: 'x' })],
    ['an MCP tool', tool('mcp__claude_ai_Atlassian__searchJira', { q: 'x' })],
    ['a Read with no path', tool('Read', {})],
    ['a Write with a non-text path', tool('Write', { file_path: 42 })],
  ])('%s has no button', (_name, t) => {
    stubFetch([])
    renderWithShell(chip(t))

    expect(openButton()).toBeNull()
  })

  it('a click opens the path of the tool in the viewer of this conversation', async () => {
    const fetchMock = stubFetch([postRoute])
    renderWithShell(chip(tool('Read', { file_path: 'src/app.py' })))

    fireEvent.click(openButton())

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(callsTo(fetchMock, 'POST')[0][0]).toBe(`/api/sessions/${KEY}/viewer`)
    expect(JSON.parse(callsTo(fetchMock, 'POST')[0][1].body)).toEqual({ caminho: 'src/app.py' })
  })

  it('an absolute Windows path goes to the server as it is: the server decides, the client resolves no root', async () => {
    const fetchMock = stubFetch([postRoute])
    const absolute = 'C:\Users\bruno\proj\src\app.py'
    renderWithShell(chip(tool('Edit', { file_path: absolute, old_string: 'a', new_string: 'b' })))

    fireEvent.click(openButton())

    await waitFor(() => expect(callsTo(fetchMock, 'POST')).toHaveLength(1))
    expect(JSON.parse(callsTo(fetchMock, 'POST')[0][1].body)).toEqual({ caminho: absolute })
  })

  it('a path the server refuses keeps the button and shows the message of the server as an alert toast', async () => {
    stubFetch([[`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST'
      ? jsonResponse({ success: false, error: 'Caminho fora da pasta do projeto' }, 403)
      : jsonResponse({ items: [] }))]])
    renderWithShell(chip(tool('Read', { file_path: '/outra/pasta/x.md' })))

    fireEvent.click(openButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Caminho fora da pasta do projeto')
    expect(openButton()).not.toBeNull()
  })

  it('without the viewer shell, or without the scope, the chip is what it was: no button', () => {
    render(<ToolChip tool={tool('Read', { file_path: 'src/app.py' })} />)
    expect(openButton()).toBeNull()
    cleanup()
    stubFetch([])
    renderWithShell(<ToolChip tool={tool('Read', { file_path: 'src/app.py' })} />)
    expect(openButton()).toBeNull()
  })

  it('the chip still folds and shows its input and result as plain text', () => {
    stubFetch([])
    renderWithShell(chip(tool('Read', { file_path: 'src/app.py' }, { result: { content: '<img src=x onerror=1>' } })))

    const details = document.querySelector('details.v3-chat-chip')
    expect(within(details).getByText('ENTRADA')).not.toBeNull()
    expect(details.querySelector('img')).toBeNull()
    expect(details.textContent).toContain('<img src=x onerror=1>')
  })
})
