import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import DeleteColumnDialog from './DeleteColumnDialog.jsx'

installDialogElementStub()

const COLUMN = { slug: 'a_fazer', label: 'A fazer', is_done: false }

beforeEach(() => resetDialogElementStubState())
afterEach(() => cleanup())

describe('DeleteColumnDialog: a second press while it deletes', () => {
  it('sends one request however many times "Excluir" is pressed, and closes once', async () => {
    let settle
    const onDelete = vi.fn().mockReturnValue(new Promise((done) => { settle = done }))
    const onClose = vi.fn()
    render(<DeleteColumnDialog column={COLUMN} onDelete={onDelete} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluindo…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluindo…' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    await act(async () => { settle({}) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('after a failure the button works again', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({})
    const onClose = vi.fn()
    render(<DeleteColumnDialog column={COLUMN} onDelete={onDelete} onClose={onClose} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui excluir. Tente de novo.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
