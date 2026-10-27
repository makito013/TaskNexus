import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import WorkspaceDialog from './WorkspaceDialog.jsx'

installDialogElementStub()
afterEach(() => cleanup())

function setup(overrides = {}) {
  const mutations = { createWorkspace: vi.fn().mockResolvedValue({ workspace: { id: 11, key: '.w11', name: 'Estudos' } }), ...overrides.mutations }
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<WorkspaceDialog mutations={mutations} onClose={onClose} onCreated={onCreated} {...overrides.props} />)
  return { mutations, onClose, onCreated, input: screen.getByLabelText('Nome do workspace') }
}

describe('WorkspaceDialog', () => {
  it('shows the plan copy: title, label, placeholder, help, callout and the two buttons', () => {
    const { input } = setup()
    expect(screen.getByRole('heading', { name: 'Novo workspace' })).toBeTruthy()
    expect(input.getAttribute('placeholder')).toBe('Ex.: Estudos')
    expect(input.getAttribute('maxlength')).toBe('80')
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('1 a 80 caracteres. Você pode renomear depois.')).toBeTruthy()
    expect(screen.getByText('Um workspace agrupa projetos, como um cliente. Ele nasce vazio e você adiciona projetos em seguida.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Criar workspace' })).toBeTruthy()
    expect(document.activeElement).toBe(input)
  })

  it('an empty name does not submit: aria-invalid, the error is the description, focus stays on the field', () => {
    const { mutations, input } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    expect(mutations.createWorkspace).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const error = screen.getByText('Informe um nome com 1 a 80 caracteres.')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
    expect(screen.queryByText('1 a 80 caracteres. Você pode renomear depois.')).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('a blank name is as invalid as an empty one', () => {
    const { mutations, input } = setup()
    fireEvent.change(input, { target: { value: '    ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    expect(mutations.createWorkspace).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('accepts 1 and 80 characters and sends the trimmed name', async () => {
    const { mutations, input } = setup()
    fireEvent.change(input, { target: { value: '  Estudos  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    await waitFor(() => expect(mutations.createWorkspace).toHaveBeenCalledWith({ name: 'Estudos', adoptLegacyKey: null }))

    cleanup()
    const second = setup()
    const eighty = 'x'.repeat(80)
    fireEvent.change(second.input, { target: { value: eighty } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    await waitFor(() => expect(second.mutations.createWorkspace).toHaveBeenCalledWith({ name: eighty, adoptLegacyKey: null }))
  })

  it('submitting with Enter works and a success reports the workspace and closes', async () => {
    const { mutations, onClose, onCreated, input } = setup()
    fireEvent.change(input, { target: { value: 'Estudos' } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 11, key: '.w11', name: 'Estudos' }))
    expect(mutations.createWorkspace).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the second click while the first request runs sends nothing and the button says it is busy', async () => {
    let finish
    const createWorkspace = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const { input, onCreated } = setup({ mutations: { createWorkspace } })
    fireEvent.change(input, { target: { value: 'Estudos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    const busy = await screen.findByRole('button', { name: 'Criando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(busy)
    expect(createWorkspace).toHaveBeenCalledTimes(1)
    finish({ workspace: { id: 1 } })
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })

  it('shows the server sentence of a 409 as an alert and keeps the dialog open', async () => {
    const conflict = Object.assign(new Error('Esse workspace já existe arquivado. Desarquive-o em "Mostrar arquivados".'), {
      status: 409, code: 'adopt_conflict',
    })
    const { onClose, onCreated, input } = setup({ mutations: { createWorkspace: vi.fn().mockRejectedValue(conflict) } })
    fireEvent.change(input, { target: { value: 'NewCo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Esse workspace já existe arquivado. Desarquive-o em "Mostrar arquivados".')
    expect(onClose).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Criar workspace' })).toBeTruthy() // can try again
  })

  it('a network failure shows the generic line, not the raw English message', async () => {
    const { input } = setup({ mutations: { createWorkspace: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) } })
    fireEvent.change(input, { target: { value: 'Estudos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir agora. Nada foi alterado.')
  })

  it('the adoption mode pre-fills the name, titles the dialog and sends adoptLegacyKey', async () => {
    const { mutations, input } = setup({ props: { initialName: 'NewCo', adoptLegacyKey: 'NewCo' } })
    expect(screen.getByRole('heading', { name: 'Criar workspace a partir de NewCo' })).toBeTruthy()
    expect(input.value).toBe('NewCo')
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    await waitFor(() => expect(mutations.createWorkspace).toHaveBeenCalledWith({ name: 'NewCo', adoptLegacyKey: 'NewCo' }))
  })

  it('Cancelar, Fechar and Escape all go through onClose', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(screen.getByLabelText('Nome do workspace'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
