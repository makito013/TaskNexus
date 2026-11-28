import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HtmlView, { HTML_SANDBOX } from './HtmlView.jsx'

afterEach(cleanup)

const ITEM = { id: 'h1', source: 'viewer', path: 'reports/q3 é.html', title: 'q3.html', updated_at: 7 }

describe('HtmlView', () => {
  it('previews in an iframe with the EXACT sandbox, no same-origin, no srcdoc, no referrer', () => {
    render(<HtmlView item={ITEM} text="<p>hi</p>" />)
    const frame = screen.getByTitle('Prévia de q3.html')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox')
    expect(HTML_SANDBOX).toBe(frame.getAttribute('sandbox'))
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.hasAttribute('srcdoc')).toBe(false)
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('src')).toBe('/api/viewer/h1/f/reports/q3%20%C3%A9.html?v=7')
  })

  it('warns only when the file has a script', () => {
    const { rerender } = render(<HtmlView item={ITEM} text="<p>hi</p>" />)
    expect(screen.queryByText('O conteúdo roda isolado; links abrem em outra aba.')).toBeNull()
    rerender(<HtmlView item={ITEM} text="<script>1</script>" />)
    expect(screen.getByText('O conteúdo roda isolado; links abrem em outra aba.')).toBeTruthy()
  })

  it('switches to the code and back, and the code tab needs the text', () => {
    const { rerender } = render(<HtmlView item={ITEM} text="<p>hi</p>" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Código' }))
    expect(screen.queryByTitle('Prévia de q3.html')).toBeNull()
    expect(document.querySelector('[data-testid="viewer-code"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTitle('Prévia de q3.html')).toBeTruthy()
    rerender(<HtmlView item={ITEM} text={null} />)
    expect(screen.getByRole('tab', { name: 'Código' }).disabled).toBe(true)
  })
})
