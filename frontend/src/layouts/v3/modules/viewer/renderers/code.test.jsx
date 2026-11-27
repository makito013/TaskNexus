import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CodeView, { MAX_RENDERED_LINES } from './CodeView.jsx'
import { highlightToTokens } from '../../../../../utils/syntaxHighlight.js'

vi.mock('../../../../../utils/syntaxHighlight.js', async (importOriginal) => ({
  ...(await importOriginal()),
  highlightToTokens: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(highlightToTokens).mockReset()
  vi.mocked(highlightToTokens).mockResolvedValue(null)
  delete document.documentElement.dataset.theme
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const flush = () => act(async () => {})
const text = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')

describe('CodeView', () => {
  it('shows plain text at once, one row per line, numbers out of the selection', async () => {
    render(<CodeView text={'a = 1\nb = 2\n'} language="python" />)
    const rows = document.querySelectorAll('[data-line]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toBe('1a = 1')
    expect(rows[0].querySelector('.v3-viewer-line__number').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(/2 linhas · python/)).toBeTruthy()
    await flush()
  })

  it('swaps the plain text for the tokens when the highlighter answers, with the same lines', async () => {
    vi.mocked(highlightToTokens).mockResolvedValue([[{ content: 'a', color: '#f00' }, { content: ' = 1' }], [{ content: 'b = 2' }]])
    render(<CodeView text={'a = 1\nb = 2'} language="python" />)
    await flush()
    const first = document.querySelector('[data-line="1"] .v3-viewer-line__text')
    expect(first.querySelectorAll('span')).toHaveLength(2)
    expect(first.querySelector('span').style.color).toBe('rgb(255, 0, 0)')
    expect(document.querySelectorAll('[data-line]')).toHaveLength(2)
  })

  it('a highlighter that REJECTS leaves the plain text and no error on screen', async () => {
    vi.mocked(highlightToTokens).mockRejectedValue(new Error('shiki chunk failed'))
    render(<CodeView text="a = 1" language="python" />)
    await flush()
    expect(document.querySelector('[data-line="1"]').textContent).toBe('1a = 1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks for the highlight again when the theme changes', async () => {
    render(<CodeView text="a = 1" language="python" />)
    await flush()
    const before = vi.mocked(highlightToTokens).mock.calls.length
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
      await Promise.resolve()
    })
    await flush()
    expect(vi.mocked(highlightToTokens).mock.calls.length).toBeGreaterThan(before)
  })

  it('does not ask for the highlight above 200 000 characters and says so', async () => {
    render(<CodeView text={'x'.repeat(200_001)} language="python" />)
    await flush()
    expect(highlightToTokens).not.toHaveBeenCalled()
    expect(screen.getByText('Arquivo grande: sem destaque de sintaxe.')).toBeTruthy()
  })

  it('does ask at exactly 200 000 characters', async () => {
    render(<CodeView text={'x'.repeat(200_000)} language="python" />)
    await flush()
    expect(highlightToTokens).toHaveBeenCalled()
    expect(screen.queryByText('Arquivo grande: sem destaque de sintaxe.')).toBeNull()
  })

  it('caps the rendered lines at 20 000 with the notice, and shows all of 20 000', { timeout: 30_000 }, () => {
    const { unmount } = render(<CodeView text={text(MAX_RENDERED_LINES)} language="text" />)
    expect(document.querySelectorAll('[data-line]')).toHaveLength(MAX_RENDERED_LINES)
    expect(screen.queryByText(/Mostrando as primeiras/)).toBeNull()
    unmount()
    render(<CodeView text={text(MAX_RENDERED_LINES + 1)} language="text" />)
    expect(document.querySelectorAll('[data-line]')).toHaveLength(MAX_RENDERED_LINES)
    expect(screen.getByText(/Mostrando as primeiras 20\.000 linhas\./)).toBeTruthy()
  })

  it('the wrap toggle is a pressed button', () => {
    render(<CodeView text="a" language="text" />)
    const toggle = screen.getByRole('button', { name: 'Quebrar linhas' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.v3-viewer-code--wrap')).not.toBeNull()
  })

  it('scrolls the panel scroller (not the page) to the requested line and marks it for 2 s', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container } = render(
      <div data-viewer-scroll="">
        <CodeView text={text(50)} language="text" line={30} flashKey={1} />
      </div>,
    )
    const scroller = container.firstChild
    expect(scroller.scrollTop).not.toBeUndefined()
    const row = document.querySelector('[data-line="30"]')
    expect(row.className).toContain('v3-viewer-line--target')
    expect(row.className).toContain('v3-viewer-line--flash')
    act(() => vi.advanceTimersByTime(2000))
    expect(row.className).toContain('v3-viewer-line--target')
    expect(row.className).not.toContain('v3-viewer-line--flash')
    expect(scrollIntoView).not.toHaveBeenCalled()
    delete Element.prototype.scrollIntoView
  })
})
