import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { chatApi } from '../../../../../services/chatApi.js'
import ModelCard, { isCurrentModel } from './ModelCard.jsx'
import PlanCard, { KEEP_PLANNING_MESSAGE } from './PlanCard.jsx'
import QuestionCard, { DECLINE_MESSAGE, answerText } from './QuestionCard.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const QUESTION = {
  id: 'q1',
  kind: 'question',
  input: {
    questions: [
      {
        question: 'Qual cor?',
        header: 'Cor',
        multiSelect: false,
        options: [{ label: 'Blue', description: 'Azul <b>forte</b>' }, { label: 'Red', description: '' }],
      },
    ],
  },
}

describe('QuestionCard', () => {
  const setup = (card = QUESTION, props = {}) => {
    const onDecide = vi.fn()
    const focusAfterDecision = vi.fn()
    const view = render(<QuestionCard card={card} agentName="Claude" status="pending" onDecide={onDecide} focusAfterDecision={focusAfterDecision} {...props} />)
    return { onDecide, focusAfterDecision, ...view }
  }

  it('shows the statement, the options as a radiogroup and the description as text', () => {
    const { container } = setup()
    expect(screen.getByRole('group', { name: 'Pergunta do agente' })).toBeTruthy()
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Qual cor?')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: /Qual cor/ })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3) // two options + "Outra resposta…"
    expect(screen.getByText('Azul <b>forte</b>')).toBeTruthy()
    expect(container.querySelector('b + b, .v3-chat-q b')).toBeNull()
  })

  it('"Responder" is aria-disabled until there is an answer and then sends it keyed by the question', () => {
    const { onDecide, focusAfterDecision } = setup()
    const respond = screen.getByRole('button', { name: 'Responder' })
    expect(respond.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(respond)
    expect(onDecide).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /Blue/ }))
    expect(respond.getAttribute('aria-disabled')).toBeNull()
    respond.focus()
    fireEvent.click(respond)
    expect(onDecide).toHaveBeenCalledWith(QUESTION, { behavior: 'allow', answers: { 'Qual cor?': 'Blue' } })
    expect(focusAfterDecision).toHaveBeenCalled()
  })

  it('"Outra resposta…" reveals a text field and its text is the answer', () => {
    const { onDecide } = setup()
    fireEvent.click(screen.getByRole('radio', { name: /Outra resposta/ }))
    expect(screen.getByRole('button', { name: 'Responder' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(screen.getByLabelText(/Outra resposta: Qual cor/), { target: { value: '  Verde  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(onDecide).toHaveBeenCalledWith(QUESTION, { behavior: 'allow', answers: { 'Qual cor?': 'Verde' } })
  })

  it('a multi-select question uses checkboxes and joins the labels with ", "', () => {
    const multi = { ...QUESTION, input: { questions: [{ ...QUESTION.input.questions[0], multiSelect: true }] } }
    const { onDecide } = setup(multi)
    fireEvent.click(screen.getByRole('checkbox', { name: /Blue/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Red/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(onDecide.mock.calls[0][1].answers).toEqual({ 'Qual cor?': 'Blue, Red' })
  })

  it('"Não responder" is a denial with a message', () => {
    const { onDecide } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Não responder' }))
    expect(onDecide).toHaveBeenCalledWith(QUESTION, { behavior: 'deny', message: DECLINE_MESSAGE })
  })

  it('Esc never decides', () => {
    const { onDecide } = setup()
    fireEvent.keyDown(screen.getByRole('radio', { name: /Blue/ }), { key: 'Escape' })
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('sending locks the card; an error says so and the card is usable again', () => {
    const { rerender, onDecide } = setup(QUESTION, { status: 'sending' })
    expect(screen.getByRole('button', { name: 'Enviando…' }).getAttribute('aria-busy')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Blue/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Não responder' }))
    expect(onDecide).not.toHaveBeenCalled()
    rerender(<QuestionCard card={QUESTION} agentName="Claude" status="error" onDecide={onDecide} />)
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível enviar sua resposta. Tente de novo.')
  })

  it.each([
    ['allowed', { 'Qual cor?': 'Blue' }, 'Você respondeu: Blue'],
    ['allowed', null, 'Você respondeu.'],
    ['denied', null, 'Você não respondeu.'],
    ['elsewhere', null, 'Decidido em outro dispositivo.'],
    ['expired', null, 'Expirou ao reabrir a conversa.'],
  ])('resolved as %s collapses to one line', (status, answered, text) => {
    setup(QUESTION, { status, answered })
    expect(screen.getByRole('status').textContent).toBe(text)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('answerText joins the chosen labels and the typed text', () => {
    expect(answerText({ labels: ['A', '__other__'], other: ' x ' })).toBe('A, x')
    expect(answerText({ labels: [], other: 'x' })).toBe('')
  })
})

describe('PlanCard', () => {
  const PLAN = { id: 'p1', kind: 'plan', input: { plan: '1. Ler\n2. <script>window.__pwned = 1</script>' } }
  const setup = (props = {}) => {
    const onDecide = vi.fn()
    const view = render(<PlanCard card={PLAN} agentName="Claude" status="pending" onDecide={onDecide} {...props} />)
    return { onDecide, ...view }
  }

  it('shows the plan as text in a labelled scrollable region', () => {
    const { container } = setup()
    const region = screen.getByRole('region', { name: 'Plano proposto' })
    expect(region.tabIndex).toBe(0)
    expect(region.textContent).toContain('<script>window.__pwned = 1</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(window.__pwned).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Ver plano completo' }))
    expect(screen.getByRole('button', { name: 'Ocultar plano completo' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('"Aprovar plano" is the only primary button and allows', () => {
    const { onDecide } = setup()
    expect(screen.getByRole('button', { name: 'Aprovar plano' }).className).toContain('v3-button--primary')
    expect(screen.getByRole('button', { name: 'Continuar planejando' }).className).not.toContain('v3-button--primary')
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar plano' }))
    expect(onDecide).toHaveBeenCalledWith(PLAN, { behavior: 'allow' })
  })

  it('"Continuar planejando" asks "O que mudar?" and denies with the comment', () => {
    const { onDecide } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }))
    const box = screen.getByLabelText('O que mudar?')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: ' trocar a ordem ' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(onDecide).toHaveBeenCalledWith(PLAN, { behavior: 'deny', message: 'trocar a ordem', note: 'trocar a ordem' })
  })

  it('without a comment the model gets the neutral message and nothing is shown back', () => {
    const { onDecide } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onDecide).toHaveBeenCalledWith(PLAN, { behavior: 'deny', message: KEEP_PLANNING_MESSAGE, note: undefined })
  })

  it('Esc inside the comment box closes it and never decides', () => {
    const { onDecide } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }))
    fireEvent.keyDown(screen.getByLabelText('O que mudar?'), { key: 'Escape' })
    expect(screen.queryByLabelText('O que mudar?')).toBeNull()
    expect(onDecide).not.toHaveBeenCalled()
  })

  it.each([
    ['allowed', null, 'Você aprovou o plano.'],
    ['denied', 'mais testes', 'Você pediu para continuar planejando.'],
    ['elsewhere', null, 'Decidido em outro dispositivo.'],
    ['expired', null, 'Expirou ao reabrir a conversa.'],
  ])('resolved as %s', (status, note, text) => {
    setup({ status, note })
    expect(screen.getByRole('status').textContent).toContain(text)
    if (note) expect(screen.getByRole('status').textContent).toContain(`Comentário: ${note}`)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an error is announced', () => {
    setup({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível enviar sua decisão. Tente de novo.')
  })
})

describe('ModelCard', () => {
  const MODELS = [
    { value: 'fable', display_name: 'Fable', description: 'O mais forte', enabled: true },
    { value: 'haiku', display_name: 'Haiku', description: 'Rápido', enabled: true },
    { value: 'old', display_name: 'Old', description: '', enabled: false },
  ]
  const setup = async (props = {}, models = MODELS) => {
    vi.spyOn(chatApi, 'fetchModels').mockResolvedValue(models)
    const setModel = vi.fn(() => 'req-1')
    const onClose = vi.fn()
    const view = render(<ModelCard currentModel="claude-haiku-4-5" setModel={setModel} onClose={onClose} {...props} />)
    await act(async () => {})
    return { setModel, onClose, ...view }
  }

  it('isCurrentModel: exact or contained in the resolved name', () => {
    expect(isCurrentModel('haiku', 'haiku')).toBe(true)
    expect(isCurrentModel('haiku', 'claude-haiku-4-5-20251001')).toBe(true)
    expect(isCurrentModel('opus', 'claude-haiku-4-5')).toBe(false)
    expect(isCurrentModel('haiku', null)).toBe(false)
  })

  it('lists the enabled models, marks the current one as "atual" and says the switch is not a restart', async () => {
    await setup()
    expect(screen.getByText('A troca vale a partir da próxima resposta. A conversa não reinicia.')).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['FableO mais forte', 'Haiku atualRápido'])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(screen.getByRole('radiogroup', { name: 'Modelos disponíveis' })).toBeTruthy()
  })

  it('shows a loading state first', () => {
    vi.spyOn(chatApi, 'fetchModels').mockReturnValue(new Promise(() => {}))
    render(<ModelCard currentModel="haiku" setModel={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Carregando modelos…')).toBeTruthy()
  })

  it('an empty or failed catalog offers "Tentar de novo"', async () => {
    const view = await setup({}, [])
    expect(screen.getByText('Nenhum modelo disponível agora.')).toBeTruthy()
    chatApi.fetchModels.mockResolvedValueOnce(MODELS)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await act(async () => {})
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    view.unmount()
    vi.spyOn(chatApi, 'fetchModels').mockRejectedValue(new Error('x'))
    render(<ModelCard currentModel="haiku" setModel={vi.fn()} onClose={vi.fn()} />)
    await act(async () => {})
    expect(screen.getByText('Nenhum modelo disponível agora.')).toBeTruthy()
  })

  it('choosing a model asks for it, shows "Aplicando…" and confirms with the NAME of the chosen entry on the first change', async () => {
    const { setModel, rerender } = await setup()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    expect(setModel).toHaveBeenCalledWith('fable')
    expect(screen.getByText('Aplicando…')).toBeTruthy()
    rerender(<ModelCard currentModel="fable" setModel={setModel} onClose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('Modelo trocado para Fable. Vale a partir da próxima resposta.')
    // the second announcement (the resolved name) changes nothing
    rerender(<ModelCard currentModel="claude-fable-9" setModel={setModel} onClose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('Modelo trocado para Fable.')
  })

  it('choosing the current model does nothing', async () => {
    const { setModel } = await setup()
    fireEvent.click(screen.getByRole('radio', { name: /Haiku/ }))
    expect(setModel).not.toHaveBeenCalled()
  })

  it('a command.rejected with the request id of the apply is the error, naming the model that stays', async () => {
    const { setModel, rerender } = await setup()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    rerender(<ModelCard currentModel="claude-haiku-4-5" rejected={{ requestId: 'req-1', code: 'model_not_allowed' }} setModel={setModel} onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível trocar o modelo. O modelo atual continua Haiku.')
  })

  it('a rejection of ANOTHER request is ignored', async () => {
    const { setModel, rerender } = await setup()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    rerender(<ModelCard currentModel="claude-haiku-4-5" rejected={{ requestId: 'other', code: 'x' }} setModel={setModel} onClose={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('without a socket (setModel returns null) the apply is an error right away', async () => {
    const { setModel } = await setup({ setModel: vi.fn(() => null) })
    expect(setModel).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('arrows move the focus, Enter and Space apply, Esc closes', async () => {
    const { setModel, onClose } = await setup()
    const [fable, haiku] = screen.getAllByRole('radio')
    haiku.focus()
    fireEvent.keyDown(haiku, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(fable)
    fireEvent.keyDown(fable, { key: 'Enter' })
    expect(setModel).toHaveBeenCalledWith('fable')
    fireEvent.keyDown(fable, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('a refused chat disables the card', async () => {
    const { setModel } = await setup({ disabled: true })
    expect(screen.getByText('O chat está indisponível.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    expect(setModel).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getAllByRole('radio')[0].getAttribute('aria-disabled')).toBe('true'))
  })
})
