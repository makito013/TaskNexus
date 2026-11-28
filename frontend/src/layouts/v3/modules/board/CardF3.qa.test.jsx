import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import CardDialog from './CardDialog.jsx'
import CardQuestions from './CardQuestions.jsx'
import ClearFinishedDialog from './ClearFinishedDialog.jsx'
import { COLUMNS, card } from './boardFixtures.js'

// QA of phase 3: the defects seen in the real browser (toast of the workspace root, focus that fell to <body>
// after deleting a question, after "Este card não existe mais." and after "Tentar de novo"), now fixed, each with
// an asynchronous case that the fix does not pull the focus from where the person already is.

installDialogElementStub()

// The real registry keeps the root of a workspace as a registered project whose key is the workspace key
// (GET /api/workspaces: "Pessoal" has a project "Pessoal"). The shared test registry does not.
const realShapedRegistry = () => {
  const folder = { id: 1, path: 'D:\\projetos\\Pessoal', is_primary: true, position: 0, exists: true }
  const project = (id, key, name) => ({ id, key, name, origin: 'legacy_seed', archived: false, primary_locked: true, folders: [{ ...folder, id }] })
  return buildRegistryIndex({
    seeded: null,
    workspaces: [{
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'legacy_seed', archived: false,
      projects: [project(1, 'Pessoal', 'Pessoal'), project(2, 'Pessoal/tn-sandbox', 'tn-sandbox')],
    }],
  })
}

afterEach(() => {
  cleanup()
  resetDialogElementStubState()
})

describe('CardDialog (QA)', () => {
  const setupCreate = (projectKey) => {
    const onSave = vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(
      <ToastHost>
        <CardDialog
          mode="create"
          card={null}
          createDefaults={{ projectKey, status: 'a_fazer' }}
          columns={COLUMNS}
          doneSlug="feito"
          registry={realShapedRegistry()}
          leavesView={() => false}
          onSave={onSave}
          onDelete={vi.fn()}
          onUploadImage={vi.fn()}
          onDeleteImage={vi.fn()}
          onAnswerQuestion={vi.fn()}
          onDeleteQuestion={vi.fn()}
          onClose={onClose}
        />
      </ToastHost>,
    )
    const dialog = screen.getByRole('dialog', { name: /./ })
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Novo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar card' }))
    return { onSave, onClose }
  }

  it('creating in a registered project says "<project> (<workspace>)" and sends projeto_id', async () => {
    const { onSave } = setupCreate('Pessoal/tn-sandbox')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].projeto_id).toBe('Pessoal/tn-sandbox')
    expect(await screen.findByText('Card criado em tn-sandbox (Pessoal).')).toBeTruthy()
  })

  // Seen live on a copy of the real database: the "Do workspace" destination of "Pessoal" is the registered
  // root project, so the toast reads "Card criado em Pessoal (Pessoal)." instead of the "Do workspace" wording
  // the Dev reported. The stored row is the same (projeto_id = 'Pessoal').
  it('creating in the workspace root says "Do workspace <name>" even when the root is a registered project', async () => {
    const { onSave } = setupCreate('Pessoal')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].projeto_id).toBe('Pessoal')
    expect(await screen.findByText('Card criado em Do workspace Pessoal.')).toBeTruthy()
  })

  // Seen live: after "Este card não existe mais." the "Salvar" button is unmounted and the focus falls to
  // <body> inside a modal; "Fechar" is the only button left and should take the focus.
  it('after "Este card não existe mais." the focus stays inside the dialog', async () => {
    const gone = Object.assign(new Error('x'), { cardGone: true })
    render(
      <ToastHost>
        <CardDialog
          mode="edit"
          card={card(12, 'Pessoal/tn-sandbox', { titulo: 'Corrigir login' })}
          createDefaults={{ projectKey: 'Pessoal/tn-sandbox', status: 'a_fazer' }}
          columns={COLUMNS}
          doneSlug="feito"
          registry={realShapedRegistry()}
          leavesView={() => false}
          onSave={vi.fn().mockRejectedValue(gone)}
          onDelete={vi.fn()}
          onUploadImage={vi.fn()}
          onDeleteImage={vi.fn()}
          onAnswerQuestion={vi.fn()}
          onDeleteQuestion={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastHost>,
    )
    const dialog = screen.getByRole('dialog', { name: /./ })
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Outro' } })
    const save = within(dialog).getByRole('button', { name: 'Salvar' })
    save.focus()
    fireEvent.click(save)
    await within(dialog).findByText('Este card não existe mais.')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })
})

describe('focus kept where the person is (QA, asynchronous)', () => {
  it('after "Este card não existe mais." the focus does not leave a field the person had moved to', async () => {
    let reject
    const onSave = vi.fn().mockReturnValue(new Promise((ok, no) => { reject = no }))
    render(
      <ToastHost>
        <CardDialog
          mode="edit"
          card={card(12, 'Pessoal/tn-sandbox', { titulo: 'Corrigir login' })}
          columns={COLUMNS}
          doneSlug="feito"
          registry={realShapedRegistry()}
          leavesView={() => false}
          onSave={onSave}
          onDelete={vi.fn()}
          onUploadImage={vi.fn()}
          onDeleteImage={vi.fn()}
          onAnswerQuestion={vi.fn()}
          onDeleteQuestion={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastHost>,
    )
    const dialog = screen.getByRole('dialog', { name: /./ })
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Outro' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    const status = within(dialog).getByLabelText('Status')
    status.focus()
    await act(async () => { reject(Object.assign(new Error('x'), { cardGone: true })) })
    await within(dialog).findByText('Este card não existe mais.')
    expect(document.activeElement).toBe(status)
  })

  it('after a question is deleted the focus does not leave a field the person had moved to', async () => {
    let resolve
    const onDelete = vi.fn().mockReturnValue(new Promise((ok) => { resolve = ok }))
    const q = (id) => ({ id, card_id: 1, question: `Pergunta ${id}?`, answer: null, asked_by: 'agente:qa', created_at: 1000, answered_at: null })
    const { rerender } = render(<CardQuestions cardId={1} questions={[q(1), q(2)]} onAnswer={vi.fn()} onDelete={onDelete} />)
    const region = screen.getByRole('region', { name: /^Perguntas do agente/ })
    const remove = within(region).getAllByRole('button', { name: /^Excluir pergunta/ })[0]
    remove.focus()
    fireEvent.click(remove)
    const other = within(region).getByRole('textbox', { name: /Pergunta 2/ })
    other.focus()
    await act(async () => { resolve({}) })
    rerender(<CardQuestions cardId={1} questions={[q(2)]} onAnswer={vi.fn()} onDelete={onDelete} />)
    await act(async () => {})
    expect(document.activeElement).toBe(other)
  })

  it('after the last question is deleted the focus goes to the panel that holds the section (the pressed button is gone)', async () => {
    const onDelete = vi.fn().mockResolvedValue({})
    const q = { id: 1, card_id: 1, question: 'Pergunta 1?', answer: null, asked_by: 'agente:qa', created_at: 1000, answered_at: null }
    const view = (list) => (
      <dialog open><div data-autofocus tabIndex={-1} data-testid="panel"><CardQuestions cardId={1} questions={list} onAnswer={vi.fn()} onDelete={onDelete} /></div></dialog>
    )
    const { rerender } = render(view([q]))
    const remove = screen.getByRole('button', { name: /^Excluir pergunta/ })
    remove.focus()
    fireEvent.click(remove)
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    rerender(view([]))
    await act(async () => {})
    expect(document.activeElement).toBe(screen.getByTestId('panel'))
  })

  it('after "Tentar de novo" succeeds the focus does not leave a control the person had moved to', async () => {
    let resolve
    const onPreview = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(new Promise((ok) => { resolve = ok }))
    render(<ClearFinishedDialog targetLabel="tn-sandbox" onPreview={onPreview} onExecute={vi.fn()} onDone={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    const retry = await within(dialog).findByRole('button', { name: 'Tentar de novo' })
    retry.focus()
    fireEvent.click(retry)
    const closeX = within(dialog).getAllByRole('button', { name: 'Fechar' })[0]
    closeX.focus()
    await act(async () => { resolve({ cards: 0, imagens: 0 }) })
    await within(dialog).findByText('Nenhum card concluído em tn-sandbox.')
    expect(document.activeElement).toBe(closeX)
  })
})

describe('CardQuestions (QA)', () => {
  const question = (id) => ({
    id, card_id: 1, question: `Pergunta ${id}?`, answer: null, asked_by: 'agente:qa', created_at: 1000, answered_at: null,
  })

  // Seen live: deleting a question unmounts the pressed button and the focus falls to <body> inside the modal.
  it('after deleting a question the focus does not fall to <body>', async () => {
    const onDelete = vi.fn().mockResolvedValue({})
    const { rerender } = render(
      <CardQuestions cardId={1} questions={[question(1), question(2)]} onAnswer={vi.fn()} onDelete={onDelete} />,
    )
    const region = screen.getByRole('region', { name: /^Perguntas do agente/ })
    const remove = within(region).getAllByRole('button', { name: /^Excluir pergunta/ })[0]
    remove.focus()
    fireEvent.click(remove)
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    rerender(<CardQuestions cardId={1} questions={[question(2)]} onAnswer={vi.fn()} onDelete={onDelete} />)
    await act(async () => {})
    expect(document.activeElement).not.toBe(document.body)
  })

  it('Ctrl+Enter saves the typed answer once and does not call delete', async () => {
    const onAnswer = vi.fn().mockResolvedValue({})
    const onDelete = vi.fn()
    render(<CardQuestions cardId={1} questions={[question(1)]} onAnswer={onAnswer} onDelete={onDelete} />)
    const field = screen.getByRole('textbox', { name: /Pergunta 1\?/ })
    fireEvent.change(field, { target: { value: 'sim' } })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1))
    expect(onAnswer).toHaveBeenCalledWith(1, 'sim')
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('ClearFinishedDialog (QA)', () => {
  // Seen live: "Tentar de novo" is the pressed button; when the retry succeeds the phase changes, the button
  // goes away and the focus falls to <body> inside the modal.
  it('after "Tentar de novo" succeeds the focus stays inside the dialog', async () => {
    const onPreview = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ cards: 0, imagens: 0 })
    render(
      <ClearFinishedDialog targetLabel="tn-sandbox" onPreview={onPreview} onExecute={vi.fn()} onDone={vi.fn()} onClose={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog')
    const retry = await within(dialog).findByRole('button', { name: 'Tentar de novo' })
    retry.focus()
    fireEvent.click(retry)
    await within(dialog).findByText('Nenhum card concluído em tn-sandbox.')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('names the exact target in the ready phase and keeps "Cancelar" focused', async () => {
    render(
      <ClearFinishedDialog
        targetLabel="Do workspace Pessoal"
        onPreview={vi.fn().mockResolvedValue({ cards: 13, imagens: 0 })}
        onExecute={vi.fn()}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('button', { name: 'Excluir 13 cards' })
    expect(dialog.textContent).toContain('13 cards concluídos')
    expect(dialog.textContent).toContain('Do workspace Pessoal')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }))
  })
})
