import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import CardQuestions from './CardQuestions.jsx'

const TOAST = 'Não consegui salvar uma resposta. Abra o card e tente de novo.'
const question = { id: 1, card_id: 1, question: 'Pergunta 1?', answer: null, asked_by: 'agente:claude', created_at: 1000, answered_at: null }
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

// The toast host stays mounted when only the questions go away, as the app's host does when the card closes.
function mount(onAnswer) {
  const tree = (show) => (
    <ToastHost>{show && <CardQuestions questions={[question]} onAnswer={onAnswer} onDelete={vi.fn()} />}</ToastHost>
  )
  const view = render(tree(true))
  return { close: () => view.rerender(tree(false)) }
}
const field = () => within(screen.getByRole('region', { name: /^Perguntas do agente/ })).getByRole('textbox')
const flushMicrotasks = () => act(async () => { await new Promise((done) => setTimeout(done, 0)) })

afterEach(() => cleanup())

describe('CardQuestions: the flush on closing', () => {
  it('a blur request still out when the card closes and then fails is sent again, and its failure is a toast', async () => {
    const gate = deferred()
    const onAnswer = vi.fn().mockReturnValueOnce(gate.promise).mockRejectedValue(new Error('down'))
    const { close } = mount(onAnswer)
    fireEvent.change(field(), { target: { value: 'sobrou' } })
    fireEvent.blur(field())
    close()
    expect(onAnswer).toHaveBeenCalledTimes(1)
    await act(async () => { gate.reject(new Error('down')) })
    await flushMicrotasks()
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect(onAnswer).toHaveBeenLastCalledWith(1, 'sobrou')
    expect(screen.getByText(TOAST)).toBeTruthy()
  })

  it('an answer refused on the blur is sent again on closing, once, without a toast when it goes through', async () => {
    const onAnswer = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({})
    const { close } = mount(onAnswer)
    fireEvent.change(field(), { target: { value: 'sobrou' } })
    fireEvent.blur(field())
    await within(screen.getByRole('region')).findByRole('alert')
    close()
    await flushMicrotasks()
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(TOAST)).toBeNull()
  })

  it('an answer refused on the blur and refused again on closing is a toast', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('down'))
    const { close } = mount(onAnswer)
    fireEvent.change(field(), { target: { value: 'sobrou' } })
    fireEvent.blur(field())
    await within(screen.getByRole('region')).findByRole('alert')
    close()
    await flushMicrotasks()
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect(screen.getByText(TOAST)).toBeTruthy()
  })

  it('a blur request that goes through while the card closes is not sent again', async () => {
    const gate = deferred()
    const onAnswer = vi.fn().mockReturnValue(gate.promise)
    const { close } = mount(onAnswer)
    fireEvent.change(field(), { target: { value: 'ok' } })
    fireEvent.blur(field())
    close()
    await act(async () => { gate.resolve({}) })
    await flushMicrotasks()
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(TOAST)).toBeNull()
  })
})
