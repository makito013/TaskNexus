import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import CardDialog from './CardDialog.jsx'
import { COLUMNS, card, registry } from './boardFixtures.js'

installDialogElementStub()

const index = registry()
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

function setup(props = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue({}),
    onDelete: vi.fn().mockResolvedValue({}),
    onUploadImage: vi.fn().mockResolvedValue({}),
    onDeleteImage: vi.fn().mockResolvedValue({}),
    onAnswerQuestion: vi.fn().mockResolvedValue({}),
    onDeleteQuestion: vi.fn().mockResolvedValue({}),
    onClose: vi.fn(),
  }
  const merged = {
    mode: 'edit',
    card: card(12, 'Pessoal/tn-sandbox', { titulo: 'Corrigir login', descricao: null, prazo: '2026-12-01', tipo: 'bug', prioridade: 'alta' }),
    createDefaults: { projectKey: 'Pessoal/tn-sandbox', status: 'em_andamento' },
    columns: COLUMNS,
    doneSlug: 'feito',
    registry: index,
    leavesView: () => false,
    ...handlers,
    ...props,
  }
  const view = render(<ToastHost><CardDialog {...merged} /></ToastHost>)
  const again = (next) => view.rerender(<ToastHost><CardDialog {...merged} {...next} /></ToastHost>)
  return { ...view, ...handlers, ...props, again }
}
const dialog = () => screen.getByRole('dialog', { name: /./ })
const field = (name) => within(dialog()).getByLabelText(name)
const button = (name) => within(dialog()).getByRole('button', { name })

afterEach(() => {
  cleanup()
  resetDialogElementStubState()
})

describe('CardDialog: creating', () => {
  it('opens on the title, on the clicked column and on the default place', () => {
    setup({ mode: 'create', card: null })
    expect(dialog().textContent).toContain('Novo card')
    expect(document.activeElement).toBe(field('Título'))
    expect(field('Status').value).toBe('em_andamento')
    expect(field('Projeto').value).toBe('Pessoal/tn-sandbox')
    expect(within(dialog()).queryByRole('button', { name: 'Excluir card' })).toBeNull()
    expect(within(dialog()).queryByText(/^Imagens/)).toBeNull()
  })

  it('offers only registered, active destinations: no archived project, no archived workspace, no stray bucket', () => {
    setup({ mode: 'create', card: null })
    const workspaces = [...field('Workspace').options].map((option) => option.textContent)
    expect(workspaces).toEqual(['Pessoal', 'podesubir', 'Estudos'])
    const projects = [...field('Projeto').options].map((option) => option.textContent)
    expect(projects).toEqual(['Do workspace', 'tn-sandbox', 'silent-a'])
  })

  it('refuses an empty title in words, moves the focus to it and sends nothing', () => {
    const { onSave } = setup({ mode: 'create', card: null })
    fireEvent.click(button('Criar card'))
    expect(within(dialog()).getByText('Dê um título ao card.')).toBeTruthy()
    expect(field('Título').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Título'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('sends the complete payload with empty optionals as null, then closes and says where the card went', async () => {
    const { onSave, onClose } = setup({ mode: 'create', card: null })
    fireEvent.change(field('Título'), { target: { value: '  Novo  ' } })
    fireEvent.click(button('Criar card'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({
      titulo: 'Novo', projeto_id: 'Pessoal/tn-sandbox', status: 'em_andamento', descricao: '', tipo: null, prazo: null, prioridade: null,
    })
    expect(await screen.findByText('Card criado em tn-sandbox (Pessoal).')).toBeTruthy()
  })

  it('a double press sends one request; Ctrl+Enter in a field creates too', async () => {
    const gate = deferred()
    const { onSave, onClose } = setup({ mode: 'create', card: null, onSave: vi.fn().mockReturnValue(gate.promise) })
    fireEvent.change(field('Título'), { target: { value: 'A' } })
    const create = button('Criar card')
    fireEvent.click(create)
    fireEvent.click(create)
    fireEvent.keyDown(field('Título'), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(create.getAttribute('aria-busy')).toBe('true')
    expect(create.textContent).toBe('Criando…')
    await act(async () => { gate.resolve({}) })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('a refusal (async) keeps the dialog and the typing, says it in words, and leaves the focus where it was', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({})
    const { onClose } = setup({ mode: 'create', card: null, onSave })
    fireEvent.change(field('Título'), { target: { value: 'A' } })
    const create = button('Criar card')
    create.focus()
    fireEvent.click(create)
    const alert = await within(dialog()).findByRole('alert')
    expect(alert.textContent).toBe('Sem conexão com o servidor. Tente de novo.')
    expect(dialog().textContent).not.toContain('Failed to fetch')
    expect(field('Título').value).toBe('A')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(create)
    fireEvent.click(create)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('a refusal does not steal the focus from a control the person already moved to; with the focus nowhere it returns to the button', async () => {
    const gate = deferred()
    setup({ mode: 'create', card: null, onSave: vi.fn().mockReturnValue(gate.promise) })
    fireEvent.change(field('Título'), { target: { value: 'A' } })
    fireEvent.click(button('Criar card'))
    field('Prioridade').focus()
    await act(async () => { gate.reject(new Error('x')) })
    await within(dialog()).findByRole('alert')
    expect(document.activeElement).toBe(field('Prioridade'))

    const second = deferred()
    cleanup()
    setup({ mode: 'create', card: null, onSave: vi.fn().mockReturnValue(second.promise) })
    fireEvent.change(field('Título'), { target: { value: 'A' } })
    fireEvent.click(button('Criar card'))
    document.activeElement.blur()
    await act(async () => { second.reject(new Error('x')) })
    await within(dialog()).findByRole('alert')
    expect(document.activeElement).toBe(button('Criar card'))
  })
})

describe('CardDialog: editing', () => {
  it('shows the card, with the focus on the panel and not on a field (no keyboard over the card on a tablet)', () => {
    setup()
    expect(dialog().textContent).toContain('Corrigir login')
    expect(dialog().textContent).toContain('#12')
    expect(field('Título').value).toBe('Corrigir login')
    expect(field('Prazo').value).toBe('2026-12-01')
    expect(document.activeElement.hasAttribute('data-autofocus')).toBe(true)
    expect(document.activeElement.tagName).not.toBe('INPUT')
    expect(dialog().textContent).toMatch(/Criado em/)
  })

  it('saving without a change sends nothing and closes', () => {
    const { onSave, onClose } = setup()
    fireEvent.click(button('Salvar'))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('touching only the title sends only the title', async () => {
    const { onSave, onClose } = setup()
    fireEvent.change(field('Título'), { target: { value: 'Outro' } })
    fireEvent.click(button('Salvar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ titulo: 'Outro' })
    expect(await screen.findByText('Card salvo.')).toBeTruthy()
  })

  it('Ctrl/Cmd+Enter in a field saves the card', async () => {
    const { onSave, onClose } = setup()
    fireEvent.change(field('Título'), { target: { value: 'Pelo teclado' } })
    fireEvent.keyDown(field('Título'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ titulo: 'Pelo teclado' })
  })

  it('clearing a field sends an empty value, not null and not nothing; "Limpar prazo" clears the date', async () => {
    const { onSave, onClose } = setup()
    fireEvent.change(field('Tipo'), { target: { value: '' } })
    fireEvent.click(button('Limpar prazo'))
    fireEvent.click(button('Salvar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ tipo: '', prazo: '' })
  })

  it('the card that arrives from the poll updates what is untouched and never what was touched', () => {
    const { again } = setup()
    fireEvent.change(field('Título'), { target: { value: 'Meu título' } })
    again({ card: card(12, 'Pessoal/tn-sandbox', { titulo: 'Título do agente', prazo: '2026-12-09', tipo: 'bug', prioridade: 'alta' }) })
    expect(field('Título').value).toBe('Meu título')
    expect(field('Prazo').value).toBe('2026-12-09')
  })

  it('moving to a place outside the current list warns, and sends only the new place', async () => {
    const { onSave, onClose } = setup({ leavesView: (key) => key === 'podesubir/ymci' })
    fireEvent.change(field('Workspace'), { target: { value: String([...field('Workspace').options].findIndex((option) => option.textContent === 'podesubir')) } })
    expect(field('Projeto').value).toBe('podesubir')
    fireEvent.change(field('Projeto'), { target: { value: 'podesubir/ymci' } })
    expect(within(dialog()).getByText('Este card vai sair da lista atual (outro workspace ou projeto).')).toBeTruthy()
    fireEvent.click(button('Salvar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ projeto_id: 'podesubir/ymci' })
  })

  it('a card in a stray bucket keeps its place as "(atual)" and saving without touching it moves nothing', async () => {
    const { onSave, onClose } = setup({ card: card(4, 'NewCo/x', { titulo: 'Solto' }) })
    expect([...field('Workspace').options].map((option) => option.textContent)).toContain('Sem workspace')
    expect([...field('Projeto').options].map((option) => option.textContent)).toContain('NewCo/x (atual)')
    fireEvent.change(field('Título'), { target: { value: 'Solto 2' } })
    fireEvent.click(button('Salvar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ titulo: 'Solto 2' })
  })

  it('a subcard has no place to choose, only the explanation', () => {
    setup({ card: card(30, 'Pessoal/tn-sandbox', { parent_id: 12 }) })
    expect(within(dialog()).queryByLabelText('Workspace')).toBeNull()
    expect(within(dialog()).getByText('Este é um subcard; o lugar dele segue o do card principal.')).toBeTruthy()
  })

  it('the card that no longer exists is told, and only "Fechar" is left', async () => {
    const gone = Object.assign(new Error('x'), { cardGone: true })
    setup({ onSave: vi.fn().mockRejectedValue(gone) })
    fireEvent.change(field('Título'), { target: { value: 'Outro' } })
    fireEvent.click(button('Salvar'))
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Este card não existe mais.')
    expect(within(dialog()).queryByRole('button', { name: 'Salvar' })).toBeNull()
    expect(within(dialog()).queryByRole('button', { name: 'Excluir card' })).toBeNull()
  })

  it('Esc closes without asking, even with changes', () => {
    const { onClose } = setup()
    fireEvent.change(field('Título'), { target: { value: 'Outro' } })
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CardDialog: description', () => {
  it('opens rendered when there is text, and shows the markdown without scripts, handlers or javascript: links', () => {
    const evil = ['# Título', '', '<script>window.pwned = 1</script><img src=x onerror="window.pwned = 2">', '', '[x](javascript:alert(1))'].join('\n')
    setup({ card: card(12, 'Pessoal/tn-sandbox', { descricao: evil }) })
    const panel = within(dialog()).getByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'Título' })).toBeTruthy()
    expect(panel.innerHTML).not.toMatch(/<script|onerror|javascript:/i)
    expect(panel.querySelector('img')).not.toBeNull()
    expect(within(dialog()).getByRole('tab', { name: 'Visualizar' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens on the editor when empty, and the tabs switch', () => {
    setup()
    expect(within(dialog()).getByRole('tab', { name: 'Editar' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(field('Descrição'), { target: { value: '**negrito**' } })
    fireEvent.click(within(dialog()).getByRole('tab', { name: 'Visualizar' }))
    expect(within(dialog()).getByRole('tabpanel').querySelector('strong').textContent).toBe('negrito')
  })
})

describe('CardDialog: delete', () => {
  it('without subtasks deletes at once, says so and closes', async () => {
    const { onDelete, onClose } = setup()
    fireEvent.click(button('Excluir card'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Card excluído.')).toBeTruthy()
  })

  it('a double press deletes once; a refusal (async) is told and the button works again', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({})
    const { onClose } = setup({ onDelete })
    const remove = button('Excluir card')
    remove.focus()
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Não consegui excluir o card. Tente de novo.')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(remove)
    fireEvent.click(remove)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('with subtasks asks first in a sibling dialog; Esc there closes only that one', async () => {
    const withSubs = card(12, 'Pessoal/tn-sandbox', { titulo: 'Pai', subcards: [card(31, 'Pessoal/tn-sandbox', { parent_id: 12 }), card(32, 'Pessoal/tn-sandbox', { parent_id: 12 })] })
    const { onDelete, onClose } = setup({ card: withSubs })
    fireEvent.click(button('Excluir card'))
    const confirm = await screen.findByRole('dialog', { name: 'Excluir card' })
    expect(confirm.textContent).toContain('as 2 subtarefas')
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Excluir card' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(button('Excluir card'))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Excluir card' })).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('CardDialog: images and questions', () => {
  const withImages = () => card(12, 'Pessoal/tn-sandbox', {
    imagens: [{ id: 1, card_id: 12, filename: 'a.png', url: '/board_uploads/12/a.png', mime_type: 'image/png', size_bytes: 1, criado_em: 1 }],
    questions: [{ id: 5, card_id: 12, question: 'Qual?', answer: null, asked_by: 'agente:x', created_at: 1, answered_at: null }],
  })

  it('shows the sections of an existing card', () => {
    setup({ card: withImages() })
    expect(within(dialog()).getByRole('heading', { name: 'Imagens (1/5)' })).toBeTruthy()
    expect(within(dialog()).getByRole('heading', { name: 'Perguntas do agente (1 sem resposta)' })).toBeTruthy()
  })

  it('an enlarged image opens as a sibling dialog; Esc closes only it and the focus goes back to the thumbnail', () => {
    const { onClose } = setup({ card: withImages() })
    const thumb = within(dialog()).getByRole('button', { name: 'Ampliar imagem 1' })
    thumb.focus()
    fireEvent.click(thumb)
    const lightbox = screen.getByRole('dialog', { name: 'Imagem 1' })
    fireEvent.keyDown(lightbox, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Imagem 1' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(thumb)
  })

  it('Ctrl+Enter inside an answer saves the answer and not the card', async () => {
    const { onAnswerQuestion, onSave } = setup({ card: withImages() })
    fireEvent.change(field('Título'), { target: { value: 'Outro título' } })
    const answer = within(dialog()).getByRole('textbox', { name: 'Qual?' })
    fireEvent.change(answer, { target: { value: 'esta' } })
    fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onAnswerQuestion).toHaveBeenCalledWith(5, 'esta'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('what is still typed in an answer when the card goes away is saved', async () => {
    const { onAnswerQuestion, unmount } = setup({ card: withImages() })
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Qual?' }), { target: { value: 'sobrou' } })
    unmount()
    await waitFor(() => expect(onAnswerQuestion).toHaveBeenCalledWith(5, 'sobrou'))
  })

  it('closing with the mouse (the field blurs first, then the card goes away) sends the answer once', async () => {
    const { onAnswerQuestion, unmount } = setup({ card: withImages() })
    const answer = within(dialog()).getByRole('textbox', { name: 'Qual?' })
    fireEvent.change(answer, { target: { value: 'sobrou' } })
    fireEvent.blur(answer)
    unmount()
    await act(async () => { await new Promise((done) => setTimeout(done, 0)) })
    expect(onAnswerQuestion).toHaveBeenCalledTimes(1)
    expect(onAnswerQuestion).toHaveBeenCalledWith(5, 'sobrou')
  })
})
