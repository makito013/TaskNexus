import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import RenameColumnDialog from './RenameColumnDialog.jsx'
import DeleteColumnDialog from './DeleteColumnDialog.jsx'

installDialogElementStub()

const COLUMN = { slug: 'a_fazer', label: 'A fazer', is_done: false }
const failure = (message, extra = {}) => Object.assign(new Error(message), extra)

beforeEach(() => resetDialogElementStubState())
afterEach(() => cleanup())

describe('RenameColumnDialog', () => {
  function setup(props = {}) {
    const onRename = props.onRename ?? vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(<RenameColumnDialog column={COLUMN} onRename={onRename} onClose={onClose} {...props} />)
    return { onRename, onClose, field: screen.getByRole('textbox', { name: 'Nome da coluna' }) }
  }

  it('asks for the name, with the current one filled and focused, and says it is global', () => {
    const { field } = setup()
    expect(screen.getByRole('dialog', { name: 'Renomear coluna' })).toBeTruthy()
    expect(field.value).toBe('A fazer')
    expect(document.activeElement).toBe(field)
    expect(screen.getByText('A coluna vale para todos os workspaces.')).toBeTruthy()
  })

  it('renames and closes', async () => {
    const { field, onRename, onClose } = setup()
    fireEvent.change(field, { target: { value: '  Backlog  ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renomear' })) })
    expect(onRename).toHaveBeenCalledWith('a_fazer', 'Backlog')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Enter in the field renames too', async () => {
    const { field, onRename } = setup()
    fireEvent.change(field, { target: { value: 'Backlog' } })
    await act(async () => { fireEvent.submit(field.closest('form')) })
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('the same name closes with no request and no error', async () => {
    const { field, onRename, onClose } = setup()
    fireEvent.change(field, { target: { value: ' A fazer ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renomear' })) })
    expect(onRename).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows busy while it saves and ignores a second press', async () => {
    let settle
    const onRename = vi.fn().mockReturnValue(new Promise((done) => { settle = done }))
    const { field } = setup({ onRename })
    fireEvent.change(field, { target: { value: 'Backlog' } })
    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }))
    const busy = screen.getByRole('button', { name: 'Renomeando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(busy)
    expect(onRename).toHaveBeenCalledTimes(1)
    await act(async () => { settle({}) })
  })

  it('a refusal of the server shows its message inside, keeps the dialog open and returns to the field', async () => {
    const onRename = vi.fn().mockRejectedValue(failure('Já existe uma coluna com esse nome.'))
    const { field, onClose } = setup({ onRename })
    fireEvent.change(field, { target: { value: 'Feito' } })
    field.blur()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renomear' })) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Já existe uma coluna com esse nome.')
    expect(onClose).not.toHaveBeenCalled()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('Feito')
    expect(screen.getByRole('button', { name: 'Renomear' }).getAttribute('aria-busy')).toBeNull()
  })

  it('a message nobody can read becomes a sentence', async () => {
    const onRename = vi.fn().mockRejectedValue(failure('[object Object]'))
    const { field } = setup({ onRename })
    fireEvent.change(field, { target: { value: 'Feito' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renomear' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui renomear. Tente de novo.')
  })

  it('the error goes away when the name is edited', async () => {
    const onRename = vi.fn().mockRejectedValue(failure('Nome vazio.'))
    const { field } = setup({ onRename })
    fireEvent.change(field, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renomear' })) })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'x' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })

  it('Cancelar closes without asking', () => {
    const { onRename, onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRename).not.toHaveBeenCalled()
  })
})

describe('DeleteColumnDialog', () => {
  function setup(props = {}) {
    const onDelete = props.onDelete ?? vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(<DeleteColumnDialog column={COLUMN} onDelete={onDelete} onClose={onClose} {...props} />)
    return { onDelete, onClose }
  }

  it('asks, naming the column and saying the effect is global, with the focus on Cancelar', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Excluir coluna' })
    expect(dialog.textContent).toContain('Excluir a coluna A fazer? Ela some de todos os workspaces.')
    expect(within(dialog).getByText('A fazer').tagName).toBe('B')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    expect(dialog.querySelector('.v3-callout--warn').textContent).toContain('Excluir a coluna A fazer? Ela some de todos os workspaces.')
  })

  it('deletes and closes', async () => {
    const { onDelete, onClose } = setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(onDelete).toHaveBeenCalledWith('a_fazer')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows busy while it deletes', async () => {
    let settle
    const onDelete = vi.fn().mockReturnValue(new Promise((done) => { settle = done }))
    setup({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('button', { name: 'Excluindo…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { settle({}) })
  })

  it.each([
    ['coluna_concluida', 'Essa é a coluna de concluídos. Marque outra como concluída antes de excluir.'],
    ['ultima_coluna', 'O board precisa de pelo menos uma coluna.'],
    ['coluna_com_cards', 'A coluna ainda tem cards. Mova ou exclua os cards primeiro.'],
  ])('a refusal for %s turns the same dialog into an explanation with only "Entendi"', async (reason, text) => {
    const onDelete = vi.fn().mockRejectedValue(failure('texto do servidor', { reason, cards: 0 }))
    const { onClose } = setup({ onDelete })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    const dialog = screen.getByRole('dialog', { name: 'Excluir coluna' })
    expect(dialog.textContent).toContain(text)
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the refusal is told by its reason, not by the words the server used', async () => {
    const onDelete = vi.fn().mockRejectedValue(failure('A coluna ainda tem cards', { reason: null }))
    setup({ onDelete })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui excluir. Tente de novo.')
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy()
  })

  it('a column with cards says how many there are, in every workspace', async () => {
    const onDelete = vi.fn().mockRejectedValue(failure('x', { reason: 'coluna_com_cards', cards: 3 }))
    setup({ onDelete })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(screen.getByRole('dialog').textContent).toContain('São 3 cards, em todos os workspaces.')
  })

  it('a failure of the network keeps the question open with a message inside', async () => {
    const onDelete = vi.fn().mockRejectedValue(failure('Failed to fetch'))
    const { onClose } = setup({ onDelete })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui excluir. Tente de novo.')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Excluir' }).getAttribute('aria-busy')).toBeNull()
  })

  it('Cancelar closes without asking', () => {
    const { onDelete, onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })
})
