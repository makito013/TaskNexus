import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import Dialog from '../../components/Dialog/Dialog.jsx'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import CardAttachments, { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from './CardAttachments.jsx'

installDialogElementStub()

const attachment = (id, filename = `file-${id}.md`, size = 1536) => ({ id, card_id: 1, filename, size_bytes: size, created_at: 1700000000 })
const many = (count) => Array.from({ length: count }, (_, index) => attachment(index + 1))
const file = (name = 'a.md', size = 10) => {
  const made = new File(['x'], name)
  Object.defineProperty(made, 'size', { value: size })
  return made
}
const region = () => screen.getByRole('region', { name: /^Anexos/ })
const input = () => region().querySelector('input[type="file"]')
const pick = (picked) => fireEvent.change(input(), { target: { files: [picked] } })
const addButton = () => within(region()).getByRole('button', { name: 'Anexar arquivo' })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}
const renderSection = (props = {}) => render(
  <CardAttachments attachments={[]} onUpload={vi.fn()} onDelete={vi.fn()} onView={null} {...props} />,
)

afterEach(() => cleanup())

describe('CardAttachments: reading', () => {
  it('shows the count, one row per file with its size, and no list when there is none', () => {
    renderSection({ attachments: [attachment(1, 'plan.md', 1536), attachment(2, 'big.pdf', 3 * 1024 * 1024)] })
    expect(within(region()).getByRole('heading', { name: 'Anexos (2/10)' })).toBeTruthy()
    expect(within(region()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(region()).getByText('plan.md')).toBeTruthy()
    expect(within(region()).getByText('1,5 KB')).toBeTruthy()
    cleanup()
    renderSection()
    expect(within(region()).getByRole('heading', { name: 'Anexos (0/10)' })).toBeTruthy()
    expect(within(region()).queryByRole('list')).toBeNull()
  })

  it('"Baixar" is a real link to the download of that attachment, with the file name as its label', () => {
    renderSection({ attachments: [attachment(7, 'relatório final.md')] })
    const link = within(region()).getByRole('link', { name: 'Baixar relatório final.md' })
    expect(link.getAttribute('href')).toBe('/api/card-attachments/7/f/relat%C3%B3rio%20final.md?download=1')
    expect(link.getAttribute('download')).toBe('relatório final.md')
  })

  it('offers "Ver" only with a viewer and only for a type that has a preview', () => {
    renderSection({ attachments: [attachment(1, 'plan.md'), attachment(2, 'pack.zip')], onView: vi.fn() })
    expect(within(region()).getByRole('button', { name: 'Ver plan.md' })).toBeTruthy()
    expect(within(region()).queryByRole('button', { name: 'Ver pack.zip' })).toBeNull()
    expect(within(region()).getByRole('link', { name: 'Baixar pack.zip' })).toBeTruthy()
  })

  it('without a viewer (an isolated card dialog) every file offers only "Baixar"', () => {
    renderSection({ attachments: [attachment(1, 'plan.md')], onView: null })
    expect(within(region()).queryByRole('button', { name: /^Ver / })).toBeNull()
    expect(within(region()).getByRole('link', { name: 'Baixar plan.md' })).toBeTruthy()
  })

  it('"Ver" hands the attachment and its own button to the parent (the focus returns there)', () => {
    const onView = vi.fn()
    const first = attachment(1, 'plan.md')
    renderSection({ attachments: [first], onView })
    const see = within(region()).getByRole('button', { name: 'Ver plan.md' })
    fireEvent.click(see)
    expect(onView).toHaveBeenCalledWith(first, see)
  })

  it('the eleventh is refused: the add button is unavailable, says 10/10 and opens no picker', () => {
    const onUpload = vi.fn()
    renderSection({ attachments: many(MAX_ATTACHMENTS), onUpload })
    const click = vi.spyOn(input(), 'click')
    expect(addButton().getAttribute('aria-disabled')).toBe('true')
    expect(within(region()).getByText('10/10 anexos')).toBeTruthy()
    fireEvent.click(addButton())
    expect(click).not.toHaveBeenCalled()
    pick(file())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('the tenth still fits: the add button works and nothing says the limit', () => {
    renderSection({ attachments: many(MAX_ATTACHMENTS - 1) })
    const click = vi.spyOn(input(), 'click')
    expect(addButton().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(addButton())
    expect(click).toHaveBeenCalledTimes(1)
    expect(within(region()).queryByText(/10\/10 anexos/)).toBeNull()
  })
})

describe('CardAttachments: uploading', () => {
  it('sends the picked file once and clears the input so the same file can be chosen again', async () => {
    const onUpload = vi.fn().mockResolvedValue({})
    renderSection({ onUpload })
    const picked = file('plan.md')
    pick(picked)
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(onUpload).toHaveBeenCalledWith(picked)
    expect(input().value).toBe('')
  })

  it('refuses a file over 25 MB before sending, and takes exactly 25 MB', async () => {
    const onUpload = vi.fn().mockResolvedValue({})
    renderSection({ onUpload })
    pick(file('big.zip', MAX_ATTACHMENT_BYTES + 1))
    expect(within(region()).getByRole('alert').textContent).toBe('O arquivo passa de 25 MB.')
    expect(onUpload).not.toHaveBeenCalled()
    pick(file('ok.zip', MAX_ATTACHMENT_BYTES))
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(within(region()).queryByRole('alert')).toBeNull()
  })

  it('while a request is out the button is busy, nothing is disabled, and a second pick is ignored', async () => {
    const pending = deferred()
    const onUpload = vi.fn().mockReturnValue(pending.promise)
    renderSection({ onUpload })
    pick(file('one.md'))
    const add = region().querySelector('[data-attachment-add]')
    await waitFor(() => expect(add.textContent).toBe('Enviando…'))
    expect(add.getAttribute('aria-busy')).toBe('true')
    expect(add.hasAttribute('disabled')).toBe(false)
    pick(file('two.md'))
    expect(onUpload).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({}) })
    expect(add.textContent).toBe('Anexar arquivo')
  })

  it('a refused upload says it in the section, in words of the action, and takes the busy state off', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('Falha ao enviar anexo'))
    renderSection({ onUpload })
    pick(file())
    expect((await within(region()).findByRole('alert')).textContent).toBe('Não consegui enviar o anexo.')
    expect(addButton().getAttribute('aria-busy')).toBeNull()
  })

  it('a lost connection is told as such, never in the browser\'s English', async () => {
    const onUpload = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    renderSection({ onUpload })
    pick(file())
    expect((await within(region()).findByRole('alert')).textContent).toBe('Sem conexão com o servidor. Tente de novo.')
  })

  it('the picker\'s native cancel does not reach the dialog around the section (it would close the card)', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Card" titleId="t" onClose={onClose}>
        <CardAttachments attachments={[]} onUpload={vi.fn()} onDelete={vi.fn()} onView={null} />
      </Dialog>,
    )
    input().dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failure that arrives after the dialog is gone becomes a toast', async () => {
    const pending = deferred()
    const onUpload = vi.fn().mockReturnValue(pending.promise)
    const view = render(
      <ToastHost>
        <CardAttachments attachments={[]} onUpload={onUpload} onDelete={vi.fn()} onView={null} />
      </ToastHost>,
    )
    pick(file())
    view.rerender(<ToastHost><span /></ToastHost>)
    await act(async () => { pending.reject(new Error('Falha ao enviar anexo')) })
    expect((await screen.findByRole('alert')).textContent).toContain('Não consegui enviar o anexo.')
  })
})

describe('CardAttachments: removing', () => {
  it('asks the parent to remove that attachment and puts the focus on the add button when it was lost', async () => {
    const pending = deferred()
    const onDelete = vi.fn().mockReturnValue(pending.promise)
    const view = renderSection({ attachments: [attachment(1, 'plan.md')], onDelete })
    const remove = within(region()).getByRole('button', { name: 'Remover plan.md' })
    remove.focus()
    fireEvent.click(remove)
    expect(onDelete).toHaveBeenCalledWith(1)
    // the row goes away with the removal: the pressed button is gone and the focus fell to <body>
    view.rerender(<CardAttachments attachments={[]} onUpload={vi.fn()} onDelete={onDelete} onView={null} />)
    expect(document.activeElement).toBe(document.body)
    await act(async () => { pending.resolve({}) })
    await waitFor(() => expect(document.activeElement).toBe(addButton()))
  })

  it('does not take the focus from a person who already moved on', async () => {
    const onDelete = vi.fn().mockResolvedValue({})
    const view = render(
      <>
        <button>Elsewhere</button>
        <CardAttachments attachments={[attachment(1, 'plan.md')]} onUpload={vi.fn()} onDelete={onDelete} onView={null} />
      </>,
    )
    fireEvent.click(within(region()).getByRole('button', { name: 'Remover plan.md' }))
    screen.getByText('Elsewhere').focus()
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    await act(async () => {})
    view.rerender(
      <>
        <button>Elsewhere</button>
        <CardAttachments attachments={[]} onUpload={vi.fn()} onDelete={onDelete} onView={null} />
      </>,
    )
    expect(document.activeElement).toBe(screen.getByText('Elsewhere'))
  })

  it('a refused removal keeps the row and says it in the section', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Falha ao remover anexo'))
    renderSection({ attachments: [attachment(1, 'plan.md')], onDelete })
    fireEvent.click(within(region()).getByRole('button', { name: 'Remover plan.md' }))
    expect((await within(region()).findByRole('alert')).textContent).toBe('Não consegui remover o anexo.')
    expect(within(region()).getByText('plan.md')).toBeTruthy()
  })

  it('a removal that fails after the dialog is gone becomes a toast', async () => {
    const pending = deferred()
    const onDelete = vi.fn().mockReturnValue(pending.promise)
    const view = render(
      <ToastHost>
        <CardAttachments attachments={[attachment(1, 'plan.md')]} onUpload={vi.fn()} onDelete={onDelete} onView={null} />
      </ToastHost>,
    )
    fireEvent.click(within(region()).getByRole('button', { name: 'Remover plan.md' }))
    view.rerender(<ToastHost><span /></ToastHost>)
    await act(async () => { pending.reject(new Error('Falha ao remover anexo')) })
    expect((await screen.findByRole('alert')).textContent).toContain('Não consegui remover o anexo.')
  })

  it('a second press on the same removal while it is out is ignored', async () => {
    const pending = deferred()
    const onDelete = vi.fn().mockReturnValue(pending.promise)
    renderSection({ attachments: [attachment(1, 'plan.md')], onDelete })
    const remove = within(region()).getByRole('button', { name: 'Remover plan.md' })
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(onDelete).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({}) })
  })
})
