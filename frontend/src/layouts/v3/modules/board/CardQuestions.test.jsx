import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import CardQuestions from './CardQuestions.jsx'

const question = (id, extra = {}) => ({
  id, card_id: 1, question: `Pergunta ${id}?`, answer: null, asked_by: 'agente:claude', created_at: 1000, answered_at: null, ...extra,
})
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}
const section = () => screen.getByRole('region', { name: /^Perguntas do agente/ })
const field = (id = 1) => within(section()).getByRole('textbox', { name: new RegExp(`Pergunta ${id}\\?`) })

function setup(props = {}) {
  const onAnswer = props.onAnswer ?? vi.fn().mockResolvedValue({})
  const onDelete = props.onDelete ?? vi.fn().mockResolvedValue({})
  const view = render(
    <ToastHost>
      <CardQuestions cardId={1} questions={props.questions ?? [question(1), question(2, { answer: 'sim' })]} onAnswer={onAnswer} onDelete={onDelete} />
    </ToastHost>,
  )
  return { ...view, onAnswer, onDelete }
}

afterEach(() => cleanup())

describe('CardQuestions: reading', () => {
  it('counts the unanswered ones in the heading and renders nothing without questions', () => {
    const { container, rerender } = setup()
    expect(within(section()).getByRole('heading', { name: 'Perguntas do agente (1 sem resposta)' })).toBeTruthy()
    rerender(<ToastHost><CardQuestions cardId={1} questions={[]} onAnswer={vi.fn()} onDelete={vi.fn()} /></ToastHost>)
    expect(container.querySelector('[role="region"]')).toBeNull()
  })
})

describe('CardQuestions: answering', () => {
  it('saves on leaving the field, trimmed, once', async () => {
    const { onAnswer } = setup()
    fireEvent.change(field(), { target: { value: '  talvez  ' } })
    fireEvent.blur(field())
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1))
    expect(onAnswer).toHaveBeenCalledWith(1, 'talvez')
  })

  it('does not send an untouched answer', () => {
    const { onAnswer } = setup()
    fireEvent.blur(field(2))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter saves, and the press does not travel up to the dialog around it', async () => {
    const parentKey = vi.fn()
    const onAnswer = vi.fn().mockResolvedValue({})
    render(
      <div onKeyDown={parentKey}>
        <CardQuestions cardId={1} questions={[question(1)]} onAnswer={onAnswer} onDelete={vi.fn()} />
      </div>,
    )
    fireEvent.change(field(), { target: { value: 'ok' } })
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(1, 'ok'))
    expect(parentKey).not.toHaveBeenCalled()
  })

  it('the "Responder" button saves, and blur plus click send a single request while it is in flight', async () => {
    const gate = deferred()
    const onAnswer = vi.fn().mockReturnValue(gate.promise)
    setup({ onAnswer })
    fireEvent.change(field(), { target: { value: 'ok' } })
    const button = within(section()).getByRole('button', { name: 'Responder' })
    fireEvent.blur(field())
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(within(section()).getByRole('status').textContent).toBe('Salvando…')
    await act(async () => { gate.resolve({}) })
  })

  it('an empty answer is sent too (it puts the question back to pending)', async () => {
    const { onAnswer } = setup()
    fireEvent.change(field(2), { target: { value: '' } })
    fireEvent.blur(field(2))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(2, ''))
  })

  it('a refusal (async) is told inline in words, the typing stays, and the focus stays where it is', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    setup({ onAnswer })
    fireEvent.change(field(), { target: { value: 'ok' } })
    const other = within(section()).getByRole('textbox', { name: /Pergunta 2/ })
    other.focus()
    fireEvent.blur(field())
    const alert = await within(section()).findByRole('alert')
    expect(alert.textContent).toBe('Sem conexão com o servidor. Tente de novo.')
    expect(field().value).toBe('ok')
    expect(document.activeElement).toBe(other)
  })

  it('leaving the field again with the same refused answer does not send it again; the button and Ctrl+Enter do', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('Falha ao salvar resposta'))
    setup({ onAnswer })
    fireEvent.change(field(), { target: { value: 'ok' } })
    fireEvent.blur(field())
    expect((await within(section()).findByRole('alert')).textContent).toBe('Não consegui salvar a resposta.')
    fireEvent.blur(field())
    fireEvent.blur(field())
    await act(async () => {})
    expect(onAnswer).toHaveBeenCalledTimes(1)
    fireEvent.click(within(section()).getByRole('button', { name: 'Responder' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2))
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(3))
    // new text brings the blur back
    fireEvent.change(field(), { target: { value: 'ok2' } })
    fireEvent.blur(field())
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(4))
  })

  it('what is still typed when the card closes is sent, and its failure becomes a toast', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('x'))
    // the host stays up when only the questions go away, as in the app
    const tree = (show) => (
      <ToastHost>{show && <CardQuestions cardId={1} questions={[question(1)]} onAnswer={onAnswer} onDelete={vi.fn()} />}</ToastHost>
    )
    const view = render(tree(true))
    fireEvent.change(field(), { target: { value: 'sobrou' } })
    view.rerender(tree(false))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(1, 'sobrou'))
    expect(await screen.findByText('Não consegui salvar uma resposta. Abra o card e tente de novo.')).toBeTruthy()
  })

  it('on closing, an answer already being sent is not sent twice', async () => {
    const gate = deferred()
    const onAnswer = vi.fn().mockReturnValue(gate.promise)
    const { unmount } = setup({ onAnswer })
    fireEvent.change(field(), { target: { value: 'ok' } })
    fireEvent.blur(field())
    unmount()
    await act(async () => { gate.resolve({}) })
    expect(onAnswer).toHaveBeenCalledTimes(1)
  })
})

describe('CardQuestions: deleting', () => {
  it('deletes one question once when pressed twice', async () => {
    const gate = deferred()
    const onDelete = vi.fn().mockReturnValue(gate.promise)
    setup({ onDelete })
    const button = within(section()).getAllByRole('button', { name: /^Excluir pergunta/ })[0]
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(1)
    await act(async () => { gate.resolve() })
  })

  it('a refusal says so inline and the button works again', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('Falha ao remover pergunta')).mockResolvedValue({})
    setup({ onDelete })
    const button = within(section()).getAllByRole('button', { name: /^Excluir pergunta/ })[0]
    button.focus()
    fireEvent.click(button)
    expect((await within(section()).findByRole('alert')).textContent).toBe('Não consegui excluir a pergunta.')
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
  })
})
