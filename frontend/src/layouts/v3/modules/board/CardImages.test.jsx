import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import Dialog from '../../components/Dialog/Dialog.jsx'
import CardImages, { MAX_IMAGES, MAX_IMAGE_BYTES } from './CardImages.jsx'

installDialogElementStub()

const image = (id) => ({ id, card_id: 1, filename: `${id}.png`, url: `/board_uploads/1/${id}.png`, mime_type: 'image/png', size_bytes: 10, criado_em: 1 })
const images = (n) => Array.from({ length: n }, (_, index) => image(index + 1))
const png = (name = 'a.png', size = 10) => {
  const file = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}
const region = () => screen.getByRole('region', { name: /^Imagens/ })
const pick = (file) => fireEvent.change(region().querySelector('input[type="file"]'), { target: { files: [file] } })
const addButton = () => within(region()).getByRole('button', { name: 'Adicionar imagem' })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => cleanup())

describe('CardImages: reading', () => {
  it('shows the count, a thumbnail to enlarge and a button to remove per image', () => {
    render(<CardImages images={images(2)} onUpload={vi.fn()} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    expect(within(region()).getByRole('heading', { name: 'Imagens (2/5)' })).toBeTruthy()
    expect(within(region()).getByRole('button', { name: 'Ampliar imagem 2' })).toBeTruthy()
    expect(within(region()).getByRole('button', { name: 'Remover imagem 1' })).toBeTruthy()
  })

  it('asks to enlarge the picked image', () => {
    const onEnlarge = vi.fn()
    render(<CardImages images={images(2)} onUpload={vi.fn()} onDelete={vi.fn()} onEnlarge={onEnlarge} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagem 2' }))
    expect(onEnlarge).toHaveBeenCalledWith(images(2)[1], 2, expect.anything())
  })

  it('the sixth image is blocked: the add button is unavailable and says 5/5, and nothing opens', () => {
    render(<CardImages images={images(MAX_IMAGES)} onUpload={vi.fn()} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    const click = vi.spyOn(region().querySelector('input[type="file"]'), 'click')
    expect(addButton().getAttribute('aria-disabled')).toBe('true')
    expect(within(region()).getByText('5/5 imagens')).toBeTruthy()
    fireEvent.click(addButton())
    expect(click).not.toHaveBeenCalled()
  })
})

describe('CardImages: uploading', () => {
  it('sends the picked file once', async () => {
    const onUpload = vi.fn().mockResolvedValue({})
    render(<CardImages images={[]} onUpload={onUpload} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    const file = png()
    pick(file)
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(onUpload).toHaveBeenCalledWith(file)
  })

  it('refuses a file over 5 MB before sending, and takes exactly 5 MB', async () => {
    const onUpload = vi.fn().mockResolvedValue({})
    render(<CardImages images={[]} onUpload={onUpload} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    pick(png('big.png', MAX_IMAGE_BYTES + 1))
    expect(within(region()).getByRole('alert').textContent).toBe('A imagem passa de 5 MB.')
    expect(onUpload).not.toHaveBeenCalled()
    pick(png('ok.png', MAX_IMAGE_BYTES))
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(within(region()).queryByRole('alert')).toBeNull())
  })

  it('a refused upload (async rejection) says so in words, keeps the focus where it was and allows another try', async () => {
    const first = deferred()
    const onUpload = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({})
    render(<CardImages images={[]} onUpload={onUpload} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    addButton().focus()
    pick(png())
    // a second pick while the first is in flight sends nothing
    pick(png('b.png'))
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(addButton().getAttribute('aria-busy')).toBe('true')
    await act(async () => { first.reject(new Error('Falha ao enviar imagem')) })
    expect(within(region()).getByRole('alert').textContent).toBe('Não consegui enviar a imagem.')
    expect(document.activeElement).toBe(addButton())
    expect(addButton().getAttribute('aria-busy')).toBeNull()
    // the same file, chosen again, is the person's decision: it is sent again
    pick(png())
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2))
  })

  it('a lost connection is told as such, never as the browser says it', async () => {
    const onUpload = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(<CardImages images={[]} onUpload={onUpload} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    pick(png())
    await waitFor(() => expect(within(region()).getByRole('alert').textContent).toBe('Sem conexão com o servidor. Tente de novo.'))
    expect(region().textContent).not.toMatch(/Failed to fetch/)
  })

  it('the add button asks for the picker only when it is free', () => {
    render(<CardImages images={[]} onUpload={vi.fn()} onDelete={vi.fn()} onEnlarge={vi.fn()} />)
    const click = vi.spyOn(region().querySelector('input[type="file"]'), 'click')
    fireEvent.click(addButton())
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('closing the file picker (native cancel that bubbles) does not close the dialog around it (C8)', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Card" titleId="t" onClose={onClose}>
        <CardImages images={[]} onUpload={vi.fn()} onDelete={vi.fn()} onEnlarge={vi.fn()} />
      </Dialog>,
    )
    const input = document.querySelector('input[type="file"]')
    input.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('CardImages: removing', () => {
  function Harness({ onDelete }) {
    const [list, setList] = useState(images(2))
    return (
      <CardImages
        images={list}
        onUpload={vi.fn()}
        onEnlarge={vi.fn()}
        onDelete={async (id) => { await onDelete(id); setList((current) => current.filter((entry) => entry.id !== id)) }}
      />
    )
  }

  it('removes one image once even if pressed twice, and the focus goes to the add button (the pressed one left)', async () => {
    const gate = deferred()
    const onDelete = vi.fn().mockReturnValue(gate.promise)
    render(<Harness onDelete={onDelete} />)
    const remove = screen.getByRole('button', { name: 'Remover imagem 1' })
    remove.focus()
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(onDelete).toHaveBeenCalledTimes(1)
    await act(async () => { gate.resolve() })
    await waitFor(() => expect(within(region()).getByRole('heading', { name: 'Imagens (1/5)' })).toBeTruthy())
    expect(document.activeElement).toBe(addButton())
  })

  it('a refusal (async) says so, keeps the focus on the button and lets the person try again', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('Falha ao remover imagem')).mockResolvedValue({})
    render(<Harness onDelete={onDelete} />)
    const remove = screen.getByRole('button', { name: 'Remover imagem 1' })
    remove.focus()
    fireEvent.click(remove)
    await waitFor(() => expect(within(region()).getByRole('alert').textContent).toBe('Não consegui remover a imagem.'))
    expect(document.activeElement).toBe(remove)
    fireEvent.click(remove)
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
  })
})
