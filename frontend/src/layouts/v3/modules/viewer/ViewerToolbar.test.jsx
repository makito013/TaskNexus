import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ViewerToolbar from './ViewerToolbar.jsx'
import { KEY } from './viewerTestKit.jsx'

let writeText
beforeEach(() => {
  vi.useFakeTimers()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  document.execCommand = vi.fn(() => false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete navigator.clipboard
  delete document.execCommand
  vi.restoreAllMocks()
})

const NOW = Date.now()
const ITEM = {
  id: 'i1',
  source: 'viewer',
  session_key: KEY,
  path: 'docs/a b/ç#plan.md',
  title: 'plan.md',
  kind: 'markdown',
  opened_by: 'agent',
  updated_at: NOW / 1000 - 180,
}
const CONTENT = { name: 'plan.md', kind: 'markdown', text: '# Plan\n', size: 2048, mime: 'text/markdown' }

function setup(props = {}) {
  const all = { item: ITEM, content: CONTENT, status: 'ready', onCloseTab: vi.fn(), ...props }
  const view = render(<ViewerToolbar {...all} />)
  return { ...all, ...view }
}
const flush = async () => {
  await act(async () => {})
}

describe('ViewerToolbar', () => {
  it('shows the path, the size and who opened it and when', () => {
    setup()
    const bar = screen.getByRole('group', { name: 'Ações do arquivo' })
    expect(bar.parentElement.querySelector('.v3-viewer-toolbar__path').textContent).toBe('docs/a b/ç#plan.md')
    expect(screen.getByText('2,0 KB')).toBeTruthy()
    expect(screen.getByText(/aberto pelo claude há 3 min/)).toBeTruthy()
  })

  it('says "por você" for a file the user opened, and says nothing about who for an artifact', () => {
    const { rerender } = setup({ item: { ...ITEM, opened_by: 'user' } })
    expect(screen.getByText(/aberto por você/)).toBeTruthy()
    rerender(<ViewerToolbar item={{ ...ITEM, source: 'artifact' }} content={CONTENT} status="ready" onCloseTab={vi.fn()} />)
    expect(screen.queryByText(/aberto/)).toBeNull()
  })

  it('"Baixar" is a real download link, encoded per segment', () => {
    setup()
    const link = screen.getByRole('link', { name: 'Baixar' })
    expect(link.getAttribute('href')).toBe('/api/viewer/i1/f/docs/a%20b/%C3%A7%23plan.md?download=1')
    expect(link.hasAttribute('download')).toBe(true)
  })

  it('"Abrir no navegador" opens a new tab with noopener noreferrer', () => {
    setup()
    const link = screen.getByRole('link', { name: 'Abrir no navegador' })
    expect(link.getAttribute('href')).toBe('/api/viewer/i1/f/docs/a%20b/%C3%A7%23plan.md')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('has no "Baixar" once the file is gone', () => {
    setup({ status: 'gone', content: null })
    expect(screen.queryByRole('link', { name: 'Baixar' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Abrir no navegador' })).toBeTruthy()
  })

  it('"Copiar" copies the CONTENT of a text file and confirms in a status', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await flush()
    expect(writeText).toHaveBeenCalledWith('# Plan\n')
    const toolbar = screen.getByRole('group', { name: 'Ações do arquivo' }).parentElement
    expect(within(toolbar).getByRole('status').textContent).toBe('Copiado')
    act(() => vi.advanceTimersByTime(2000))
    expect(within(toolbar).queryByRole('status')).toBeNull()
  })

  it('"Copiar" copies the PATH when the file has no text', async () => {
    setup({ content: { ...CONTENT, kind: 'image', text: undefined } })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await flush()
    expect(writeText).toHaveBeenCalledWith('docs/a b/ç#plan.md')
  })

  it('a copy that is refused later says so in pt-BR, as an alert, and clears itself', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await flush()
    const toolbar = screen.getByRole('group', { name: 'Ações do arquivo' }).parentElement
    expect(within(toolbar).getByRole('alert').textContent).toBe('Não consegui copiar')
    act(() => vi.advanceTimersByTime(2000))
    expect(within(toolbar).queryByRole('alert')).toBeNull()
  })

  it('a copy that finishes after the toolbar left does not touch the screen (no state update after unmount)', async () => {
    let resolveWrite
    writeText.mockReturnValueOnce(new Promise((resolve) => { resolveWrite = resolve }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    unmount()
    await act(async () => resolveWrite())
    expect(errors).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the "⋯" menu copies the path, links to the browser and closes the tab', async () => {
    const { onCloseTab } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do arquivo' }))
    const menu = screen.getByRole('menu', { name: 'Mais ações do arquivo' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Copiar caminho', 'Abrir no navegador', 'Fechar aba'])
    expect(items[1].getAttribute('target')).toBe('_blank')
    expect(items[1].getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(items[0])
    await flush()
    expect(writeText).toHaveBeenCalledWith('docs/a b/ç#plan.md')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do arquivo' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar aba' }))
    expect(onCloseTab).toHaveBeenCalledTimes(1)
  })

  it('Esc closes the menu, hands the focus back to its button and stops there', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ViewerToolbar item={ITEM} content={CONTENT} status="ready" onCloseTab={vi.fn()} />
      </div>,
    )
    const button = screen.getByRole('button', { name: 'Mais ações do arquivo' })
    fireEvent.click(button)
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(outer).not.toHaveBeenCalled()
  })

  it('renders nothing without an item', () => {
    const { container } = render(<ViewerToolbar item={null} content={null} status="idle" />)
    expect(container.firstChild).toBeNull()
  })
})
