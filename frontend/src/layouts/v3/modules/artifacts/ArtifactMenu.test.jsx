import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { probe } from '../viewer/viewerTestKit.jsx'
import { artifact } from './artifactFixtures.js'
import ArtifactMenu, { CONFIRM_SECONDS, placeMenu } from './ArtifactMenu.jsx'
import { createArtifactsKit, failure, notFound } from './artifactTestKit.jsx'

installDialogElementStub()

const row = artifact(1, 'Pessoal/tn-sandbox', { title: 'Relatório Q3', path: 'docs/q3.md' })
const RECT = { top: 100, bottom: 130, left: 300, right: 340 }

function setup(props = {}) {
  const handlers = {
    onClose: vi.fn(), onOpen: vi.fn(), onCopyPath: vi.fn(), onCite: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(),
  }
  const view = render(
    <ArtifactMenu artifact={row} anchorRect={RECT} cite={{ enabled: true, reason: '' }} {...handlers} {...props} />,
  )
  return { ...view, ...handlers }
}
const menu = () => screen.getByRole('menu')
const items = () => within(menu()).getAllByRole('menuitem')
const item = (name) => within(menu()).getByRole('menuitem', { name })

beforeEach(() => { window.innerWidth = 1440 })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 }
  it('opens below the anchor, aligned to its right edge', () => {
    expect(placeMenu({ top: 100, bottom: 130, left: 300, right: 500 }, 200, viewport)).toEqual({ left: 260, top: 136, width: 240 })
  })
  it('opens above when it does not fit below', () => {
    const { top } = placeMenu({ top: 700, bottom: 730, left: 300, right: 500 }, 200, viewport)
    expect(top).toBe(700 - 200 - 6)
  })
  it('never leaves the window: clamped on both sides and never above the top', () => {
    expect(placeMenu({ top: 0, bottom: 10, left: 0, right: 20 }, 2000, viewport).top).toBe(8)
    expect(placeMenu({ top: 10, bottom: 20, left: 0, right: 20 }, 100, viewport).left).toBe(8)
    expect(placeMenu({ top: 10, bottom: 20, left: 980, right: 1000 }, 100, viewport).left).toBe(1000 - 240 - 8)
  })
  it('narrows to the window on a small screen', () => {
    expect(placeMenu({ top: 10, bottom: 20, left: 0, right: 100 }, 100, { width: 200, height: 800 }).width).toBe(184)
  })
})

describe('ArtifactMenu: the items', () => {
  it('lists the six actions in order, in a portal on <body>, the first one focused', () => {
    setup()
    expect(items().map((entry) => entry.textContent)).toEqual([
      'Abrir', 'Baixar', 'Copiar caminho', 'Citar no chat', 'Renomear…', 'Remover da lista',
    ])
    expect(document.activeElement).toBe(item('Abrir'))
    expect(menu().parentElement).toBe(document.body)
    expect(menu().getAttribute('role')).toBe('menu')
  })

  it('"Baixar" is a real download link (Safari saves only a tapped link) and names the file', () => {
    setup()
    const link = item('Baixar')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/api/artifacts/a1/f/docs/q3.md?download=1')
    expect(link.getAttribute('download')).toBe('q3.md')
  })

  it('a vanished file offers neither "Baixar" nor "Citar no chat"', () => {
    setup({ artifact: { ...row, exists: false } })
    expect(items().map((entry) => entry.textContent)).toEqual(['Abrir', 'Copiar caminho', 'Renomear…', 'Remover da lista'])
  })

  it('each action closes the menu with the focus going back and then acts on the artifact', () => {
    const { onClose, onOpen, onCopyPath, onCite, onRename } = setup()
    fireEvent.click(item('Abrir'))
    expect(onOpen).toHaveBeenCalledWith(row)
    fireEvent.click(item('Copiar caminho'))
    expect(onCopyPath).toHaveBeenCalledWith(row)
    fireEvent.click(item('Citar no chat'))
    expect(onCite).toHaveBeenCalledWith(row)
    fireEvent.click(item('Renomear…'))
    expect(onRename).toHaveBeenCalledWith(row)
    expect(onClose).toHaveBeenCalledTimes(4)
    for (const call of onClose.mock.calls) expect(call).toEqual([true])
  })

  it('"Citar no chat" with nothing to cite into stays focusable, explains why, and does nothing', () => {
    const { onCite, onClose } = setup({ cite: { enabled: false, reason: 'Abra uma conversa deste projeto para citar.' } })
    const cite = item('Citar no chat')
    expect(cite.getAttribute('aria-disabled')).toBe('true')
    expect(cite.disabled).toBe(false)
    expect(cite.tabIndex).not.toBe(-1)
    const reason = document.getElementById(cite.getAttribute('aria-describedby'))
    expect(reason.textContent).toBe('Abra uma conversa deste projeto para citar.')
    cite.focus()
    expect(document.activeElement).toBe(cite)
    fireEvent.click(cite)
    expect(onCite).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('every item is 44 px by class and none is a nested button', () => {
    setup()
    for (const entry of items()) expect(entry.className).toContain('v3-artifact-menu__item')
    expect(menu().querySelector('button button')).toBeNull()
  })
})

describe('ArtifactMenu: keyboard and closing', () => {
  it('the arrows, Home and End walk the items and wrap', () => {
    setup()
    const names = () => document.activeElement.textContent
    fireEvent.keyDown(menu(), { key: 'ArrowDown' })
    expect(names()).toBe('Baixar')
    fireEvent.keyDown(menu(), { key: 'End' })
    expect(names()).toBe('Remover da lista')
    fireEvent.keyDown(menu(), { key: 'ArrowDown' })
    expect(names()).toBe('Abrir')
    fireEvent.keyDown(menu(), { key: 'ArrowUp' })
    expect(names()).toBe('Remover da lista')
    fireEvent.keyDown(menu(), { key: 'Home' })
    expect(names()).toBe('Abrir')
  })

  it('Esc closes it, gives the focus back and never reaches a handler behind it', () => {
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    const { onClose } = setup()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(true)
    expect(behind).not.toHaveBeenCalled()
    window.removeEventListener('keydown', behind)
  })

  it('a press on the scrim closes it and gives the focus back; Tab closes it without taking the focus', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByTestId('artifact-menu-scrim'))
    expect(onClose).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(menu(), { key: 'Tab' })
    expect(onClose).toHaveBeenLastCalledWith(false)
  })

  it('opened by a long press, the residual click of the lifting finger does not close it; a press of its own does', () => {
    const { onClose } = setup({ viaLongPress: true })
    const scrim = screen.getByTestId('artifact-menu-scrim')
    fireEvent.click(scrim)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(scrim, { pointerType: 'touch' })
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenLastCalledWith(true)
  })

  it('opened any other way, a bare click on the scrim closes it as before', () => {
    const { onClose } = setup({ viaLongPress: false })
    fireEvent.click(screen.getByTestId('artifact-menu-scrim'))
    expect(onClose).toHaveBeenCalledWith(true)
  })
})

describe('ArtifactMenu: "Remover da lista" asks for a second tap', () => {
  it('the first tap only arms it, in words, with the seconds left; the second removes', () => {
    vi.useFakeTimers()
    const { onRemove, onClose } = setup()
    fireEvent.click(item('Remover da lista'))
    expect(onRemove).not.toHaveBeenCalled()
    expect(item(`Toque de novo para remover (${CONFIRM_SECONDS} s)`)).toBeTruthy()
    expect(within(menu()).getByRole('status').textContent).toContain('Toque de novo')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(item('Toque de novo para remover (2 s)')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(item('Toque de novo para remover (1 s)')).toBeTruthy()
    fireEvent.click(item('Toque de novo para remover (1 s)'))
    expect(onRemove).toHaveBeenCalledWith(row)
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('after 3 s without the second tap it goes back to normal and a tap arms it again', () => {
    vi.useFakeTimers()
    const { onRemove } = setup()
    fireEvent.click(item('Remover da lista'))
    for (let second = 0; second < CONFIRM_SECONDS; second += 1) act(() => { vi.advanceTimersByTime(1000) })
    expect(item('Remover da lista')).toBeTruthy()
    expect(within(menu()).getByRole('status').textContent).toBe('')
    fireEvent.click(item('Remover da lista'))
    expect(onRemove).not.toHaveBeenCalled()
    expect(item('Toque de novo para remover (3 s)')).toBeTruthy()
  })

  it('removing is only ever a request for the row: the menu has no action that deletes a file', () => {
    setup()
    expect(items().map((entry) => entry.textContent).join(' ')).not.toMatch(/apagar|excluir|deletar/i)
  })
})

// ---- through the tab: the focus, the DELETE, the toasts ----
const { backend, renderTab } = createArtifactsKit({ vi, render })
const more = (title) => screen.getByRole('button', { name: `Ações de ${title}` })
const loaded = () => screen.findByText('Relatório Q3')

describe('the menu in the Artefatos tab', () => {
  beforeEach(() => {
    clearViewerContentCache()
    window.sessionStorage.clear()
  })

  it('the "⋯" opens it; Esc and a press outside both give the focus back to the "⋯"', async () => {
    backend()
    renderTab()
    await loaded()
    const trigger = more('Relatório Q3')
    fireEvent.click(trigger)
    expect(menu()).toBeTruthy()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('artifact-menu-scrim'))
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('the right button opens it for that card and Esc returns the focus to its title', async () => {
    backend()
    renderTab()
    await loaded()
    const title = screen.getByRole('button', { name: 'Relatório Q3 (MD)' })
    fireEvent.contextMenu(title.closest('article'), { clientX: 40, clientY: 60 })
    expect(menu()).toBeTruthy()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('"Copiar caminho" copies the path of the project and says so', async () => {
    const written = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: written } })
    backend()
    renderTab()
    await loaded()
    fireEvent.click(more('Relatório Q3'))
    fireEvent.click(item('Copiar caminho'))
    expect(await screen.findByText('Caminho copiado.')).toBeTruthy()
    expect(written).toHaveBeenCalledWith('docs/q3.md')
  })

  it('removes with two taps: ONE DELETE of the row, no file route, the card goes, the tab closes, the file stays', async () => {
    const { calls, fetchMock } = backend()
    renderTab()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Relatório Q3 (MD)' }))
    await waitFor(() => expect(probe.viewer.getScope('artefatos').items.map((entry) => entry.id)).toEqual(['a1']))
    fireEvent.click(more('Relatório Q3'))
    fireEvent.click(item('Remover da lista'))
    expect(calls('/api/artifacts/a1', 'DELETE').length).toBe(0)
    fireEvent.click(item('Toque de novo para remover (3 s)'))
    expect(await screen.findByText('Removido da lista. O arquivo continua no projeto.')).toBeTruthy()
    expect(screen.queryByText('Relatório Q3')).toBeNull()
    expect(probe.viewer.getScope('artefatos').items).toEqual([])
    expect(calls('/api/artifacts/a1', 'DELETE').length).toBe(1)
    // nothing else was written: the only write of the whole session is that DELETE
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    expect(writes.map(([url, init]) => `${init.method} ${url}`)).toEqual(['DELETE /api/artifacts/a1'])
  })

  it('a 404 counts as removed', async () => {
    backend({ remove: () => notFound() })
    renderTab()
    await loaded()
    fireEvent.click(more('Relatório Q3'))
    fireEvent.click(item('Remover da lista'))
    fireEvent.click(item('Toque de novo para remover (3 s)'))
    expect(await screen.findByText('Removido da lista. O arquivo continua no projeto.')).toBeTruthy()
    expect(screen.queryByText('Relatório Q3')).toBeNull()
  })

  it('a failed removal keeps the card and says why', async () => {
    backend({ remove: () => failure(500, 'Falhou no servidor.') })
    renderTab()
    await loaded()
    fireEvent.click(more('Relatório Q3'))
    fireEvent.click(item('Remover da lista'))
    fireEvent.click(item('Toque de novo para remover (3 s)'))
    expect(await screen.findByText('Falhou no servidor.')).toBeTruthy()
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
  })

  it('a network failure on removal is said in Portuguese, never "Failed to fetch"', async () => {
    backend({ remove: () => { throw new TypeError('Failed to fetch') } })
    renderTab()
    await loaded()
    fireEvent.click(more('Relatório Q3'))
    fireEvent.click(item('Remover da lista'))
    fireEvent.click(item('Toque de novo para remover (3 s)'))
    expect(await screen.findByText('Sem conexão com o servidor. Tente de novo.')).toBeTruthy()
    expect(screen.queryByText(/failed to fetch/i)).toBeNull()
  })

  it('a card of a vanished file has a menu with no "Baixar" and no "Citar no chat"', async () => {
    backend({ artifacts: [artifact(1, 'Pessoal/tn-sandbox', { title: 'Gone', path: 'gone.md', exists: false })] })
    renderTab()
    await screen.findByText('Gone')
    fireEvent.click(more('Gone'))
    expect(items().map((entry) => entry.textContent)).toEqual(['Abrir', 'Copiar caminho', 'Renomear…', 'Remover da lista'])
  })

  it('a menu opened near the bottom edge opens above its anchor', async () => {
    backend()
    renderTab()
    await loaded()
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    const trigger = more('Relatório Q3')
    trigger.getBoundingClientRect = () => ({ top: 700, bottom: 730, left: 300, right: 340 })
    window.innerHeight = 768
    fireEvent.click(trigger)
    expect(parseFloat(menu().style.top)).toBe(700 - 300 - 6)
    delete HTMLElement.prototype.offsetHeight
  })
})
