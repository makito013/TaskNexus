import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import BoardTab from './BoardTab.jsx'
import { CARDS, COLUMNS, registry } from './boardFixtures.js'

installDialogElementStub()

const index = registry()

beforeEach(() => {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
})
afterEach(() => {
  cleanup()
  resetDialogElementStubState()
  vi.restoreAllMocks()
})

function mount(workspaceKey) {
  const element = (key) => <ToastHost><BoardTab registry={index} workspaceKey={key} showArchived={false} /></ToastHost>
  const view = render(element(workspaceKey))
  return { rerenderWith: (key) => view.rerender(element(key)) }
}

describe('BoardTab: "Limpar concluídos" keeps the target it was opened for', () => {
  it('runs on the key shown when the dialog opened, even if the board scope changes under it', async () => {
    const { rerenderWith } = mount('Pessoal')
    await screen.findAllByText(/^Card /)
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 2, imagens: 0, imagens_com_falha: 0 })
    vi.spyOn(api, 'clearFinished').mockResolvedValue({ cards: 2, imagens: 0, imagens_com_falha: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar concluídos' }))
    const confirm = await screen.findByRole('button', { name: 'Excluir 2 cards' })
    // the registry is read again and the board now looks at another workspace: the root of THAT one is the new target
    rerenderWith('podesubir')
    expect(screen.getByRole('dialog').textContent).toContain('tn-sandbox')
    fireEvent.click(confirm)
    await waitFor(() => expect(api.clearFinished).toHaveBeenCalledTimes(1))
    expect(api.clearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
    expect(api.previewClearFinished).toHaveBeenCalledTimes(1)
    expect(api.previewClearFinished).toHaveBeenCalledWith('Pessoal/tn-sandbox')
  })

  it('stays open when the scope no longer has a target at all', async () => {
    const { rerenderWith } = mount('Pessoal')
    await screen.findAllByText(/^Card /)
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    vi.spyOn(api, 'previewClearFinished').mockResolvedValue({ cards: 1, imagens: 0, imagens_com_falha: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar concluídos' }))
    await screen.findByRole('button', { name: 'Excluir 1 card' })
    rerenderWith('')
    expect(screen.getByRole('dialog').textContent).toContain('tn-sandbox')
  })

  it('"Tentar de novo" on a failed preview reads the same key, not the one the scope has now', async () => {
    const { rerenderWith } = mount('Pessoal')
    await screen.findAllByText(/^Card /)
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    vi.spyOn(api, 'previewClearFinished')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ cards: 1, imagens: 0, imagens_com_falha: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar concluídos' }))
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' })
    rerenderWith('podesubir')
    fireEvent.click(retry)
    await screen.findByRole('button', { name: 'Excluir 1 card' })
    expect(api.previewClearFinished).toHaveBeenCalledTimes(2)
    expect(api.previewClearFinished).toHaveBeenLastCalledWith('Pessoal/tn-sandbox')
  })
})
