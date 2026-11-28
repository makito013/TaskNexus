import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import MarkdownView from './MarkdownView.jsx'
import { highlightToTokens } from '../../../../../utils/syntaxHighlight.js'

vi.mock('../../../../../utils/syntaxHighlight.js', async (importOriginal) => ({
  ...(await importOriginal()),
  highlightToTokens: vi.fn(),
}))

const ITEM = { id: 'i1', source: 'viewer', path: 'docs/guide/a.md', title: 'a.md', updated_at: 1 }
let writeText

beforeEach(() => {
  vi.mocked(highlightToTokens).mockReset()
  vi.mocked(highlightToTokens).mockResolvedValue(null)
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => {
  cleanup()
  delete navigator.clipboard
  vi.useRealTimers()
})

const flush = () => act(async () => {})
const view = (text, props = {}) => render(<MarkdownView item={ITEM} text={text} onOpenLink={vi.fn()} {...props} />)

describe('MarkdownView: content', () => {
  it('renders GFM and sanitises what could run', () => {
    view('# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.hacked = 1</script><img src=x onerror="window.hacked = 1">\n\n[x](javascript:alert(1))')
    expect(screen.getByRole('heading', { name: 'T' })).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    const html = document.querySelector('.v3-viewer-markdown').innerHTML
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('a code block gets a "py · Copiar" header and the copy puts the source on the clipboard', async () => {
    view('```py\nprint(1)\n```')
    const block = document.querySelector('.v3-viewer-codeblock')
    expect(block.querySelector('.v3-viewer-codeblock__label').textContent).toBe('py')
    const copy = within(block).getByRole('button', { name: 'Copiar código (py)' })
    fireEvent.click(copy)
    await flush()
    expect(writeText).toHaveBeenCalledWith('print(1)\n')
    expect(copy.textContent).toBe('Copiado')
  })

  it('a refused copy says so in pt-BR', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => false)
    view('```py\nprint(1)\n```')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código (py)' }))
    await flush()
    expect(screen.getByRole('button', { name: 'Copiar código (py)' }).textContent).toBe('Não consegui copiar')
    delete document.execCommand
  })

  it('does not duplicate the header when the effect runs twice (StrictMode)', async () => {
    const { StrictMode } = await import('react')
    render(<StrictMode><MarkdownView item={ITEM} text={'```js\nlet a\n```'} onOpenLink={vi.fn()} /></StrictMode>)
    expect(document.querySelectorAll('.v3-viewer-codeblock')).toHaveLength(1)
    expect(document.querySelectorAll('.v3-viewer-codeblock__head')).toHaveLength(1)
  })

  it('a highlight that rejects leaves the block as plain text', async () => {
    vi.mocked(highlightToTokens).mockRejectedValue(new Error('chunk'))
    view('```py\nprint(1)\n```')
    await flush()
    expect(document.querySelector('pre code').textContent).toBe('print(1)\n')
  })

  it('a relative image resolves against the folder of the file', () => {
    view('![logo](../img/logo.png)')
    expect(document.querySelector('img').getAttribute('src')).toBe('/api/viewer/i1/f/docs/img/logo.png')
  })
})

describe('MarkdownView: links', () => {
  it('a relative link goes to onOpenLink with this file as the base, and does not navigate', () => {
    const onOpenLink = vi.fn()
    view('[other](../other.md#L10)', { onOpenLink })
    const link = screen.getByRole('link', { name: 'other' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).toHaveBeenCalledWith('../other.md#L10', { relativoA: 'docs/guide/a.md' }, ITEM)
  })

  it('a project-root link drops the slash and the base', () => {
    const onOpenLink = vi.fn()
    view('[root](/docs/x.md)', { onOpenLink })
    fireEvent.click(screen.getByRole('link', { name: 'root' }))
    expect(onOpenLink).toHaveBeenCalledWith('docs/x.md', {}, ITEM)
  })

  it('an external link opens in a new tab with noopener and noreferrer, and never reaches onOpenLink', () => {
    const onOpenLink = vi.fn()
    view('[site](https://example.com/a)', { onOpenLink })
    const link = screen.getByRole('link', { name: 'site' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    fireEvent.click(link)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('an anchor scrolls the panel scroller, focuses the target, and never uses scrollIntoView', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(
      <div data-viewer-scroll="">
        <MarkdownView item={ITEM} text={'[go](#second)\n\n# First\n\n## Second'} onOpenLink={vi.fn()} />
      </div>,
    )
    const onOpenLink = vi.fn()
    expect(onOpenLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'go' }))
    const target = screen.getByRole('heading', { name: 'Second' })
    expect(target.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(target)
    expect(scrollIntoView).not.toHaveBeenCalled()
    delete Element.prototype.scrollIntoView
  })

  it('a relative link without a handler does nothing (no navigation)', () => {
    view('[other](other.md)', { onOpenLink: undefined })
    const link = screen.getByRole('link', { name: 'other' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
