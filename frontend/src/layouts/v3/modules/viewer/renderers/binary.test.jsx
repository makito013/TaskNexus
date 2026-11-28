import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { renderBody } from './index.jsx'
import BinaryView from './BinaryView.jsx'

afterEach(cleanup)

const ITEM = { id: 'b1', source: 'viewer', path: 'dist/app.zip', title: 'app.zip', updated_at: 5 }

function Large({ content }) {
  const [show, setShow] = useState(false)
  return renderBody({ item: ITEM, content, showAnyway: show, onShowAnyway: () => setShow(true) }).node
}

describe('BinaryView', () => {
  it('names the file, shows type and size, and puts "Baixar" first, with no "Mostrar o começo"', () => {
    render(<BinaryView item={ITEM} content={{ name: 'app.zip', mime: 'application/zip', size: 3 * 1024 * 1024 }} />)
    expect(screen.getByRole('heading', { name: 'app.zip' })).toBeTruthy()
    expect(screen.getByText('application/zip · 3,0 MB')).toBeTruthy()
    expect(screen.getByText('Esse arquivo é grande ou não tem pré-visualização.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Baixar' }).getAttribute('href')).toBe('/api/viewer/b1/f/dist/app.zip?download=1')
    expect(screen.queryByRole('button', { name: 'Mostrar o começo' })).toBeNull()
  })

  it('a text above 1 MB shows the card first and the text only after "Mostrar o começo"', () => {
    render(<Large content={{ kind: 'code', truncated: true, text: 'first line\nsecond', name: 'big.log', size: 5_000_000 }} />)
    expect(screen.queryByText('first line')).toBeNull()
    expect(screen.queryByTestId('viewer-code')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar o começo' }))
    expect(screen.getByText('Mostrando só o primeiro 1 MB. Baixe para ver o arquivo inteiro.')).toBeTruthy()
    expect(screen.getByTestId('viewer-code')).toBeTruthy()
  })

  it('a truncated HTML is not turned into a card (its iframe loads the whole file)', () => {
    const { node } = renderBody({ item: { ...ITEM, path: 'a.html' }, content: { kind: 'html', truncated: true, text: '<p>x</p>' } })
    render(node)
    expect(screen.getByTitle(/Prévia de/)).toBeTruthy()
  })
})
