import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderBody } from './index.jsx'
import ImageView from './ImageView.jsx'
import PdfView from './PdfView.jsx'

afterEach(cleanup)

const item = (path, extra = {}) => ({ id: 'm1', source: 'viewer', path, title: path, updated_at: 3, ...extra })
const draw = (args) => render(<div>{renderBody({ onOpenLink: () => {}, ...args }).node}</div>)

describe('ImageView', () => {
  it('shows the image through <img> only, with a pressed toggle between fit and real size', () => {
    render(<ImageView item={item('art/logo.svg')} />)
    const image = screen.getByRole('img')
    expect(image.getAttribute('src')).toBe('/api/viewer/m1/f/art/logo.svg?v=3')
    expect(document.querySelector('object, embed, iframe')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Tamanho real' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Caber na tela' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.v3-viewer-image__frame--actual')).not.toBeNull()
  })

  it('a load failure becomes a card with "Baixar"', () => {
    render(<ImageView item={item('art/logo.png')} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('alert').textContent).toContain('Não consegui carregar a imagem.')
    expect(screen.getByRole('link', { name: 'Baixar' }).getAttribute('href')).toBe('/api/viewer/m1/f/art/logo.png?download=1')
  })
})

describe('PdfView', () => {
  it('always shows "Abrir" and "Baixar" above an unsandboxed iframe, with the iPad notice', () => {
    render(<PdfView item={item('docs/spec.pdf')} />)
    const frame = screen.getByTitle('PDF spec.pdf')
    expect(frame.hasAttribute('sandbox')).toBe(false)
    expect(screen.getByRole('link', { name: 'Abrir' }).getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('link', { name: 'Abrir' }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Baixar' }).hasAttribute('download')).toBe(true)
    expect(screen.getByText('No iPad o PDF pode aparecer só na primeira página. Use Abrir para ver tudo.')).toBeTruthy()
  })
})

describe('the choice of renderer follows the SERVER kind, never the extension', () => {
  it('a .pdf whose content kind is binary gets NO iframe', () => {
    draw({ item: item('docs/fake.pdf'), content: { kind: 'binary', name: 'fake.pdf', size: 10 } })
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByTestId('viewer-binary')).toBeTruthy()
  })

  it('a file with another extension but kind pdf gets the PDF iframe', () => {
    draw({ item: item('docs/report.bin'), content: { kind: 'pdf' } })
    expect(screen.getByTitle('PDF report.bin')).toBeTruthy()
  })

  it('an .html path whose content kind is code is shown as code, not run', () => {
    draw({ item: item('x/page.html'), content: { kind: 'code', text: '<b>x</b>', language: 'html' } })
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByTestId('viewer-code')).toBeTruthy()
  })

  it('an attachment without kind on the item uses the kind of the content', () => {
    draw({ item: { id: 'att1', source: 'card_attachment', path: 'notes.md', updated_at: 1 }, content: { kind: 'markdown', text: '# Hi' } })
    expect(screen.getByRole('heading', { name: 'Hi' })).toBeTruthy()
  })

  it('an image kind and a video kind', () => {
    const { unmount } = draw({ item: item('a.png'), content: { kind: 'image' } })
    expect(screen.getByRole('img')).toBeTruthy()
    unmount()
    draw({ item: item('a.mp4'), content: { kind: 'video', name: 'a.mp4' } })
    expect(screen.getByText('O visualizador ainda não toca vídeo. Baixe para assistir.')).toBeTruthy()
  })
})
