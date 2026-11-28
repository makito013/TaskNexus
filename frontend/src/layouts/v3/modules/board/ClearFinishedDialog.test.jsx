import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ClearFinishedDialog from './ClearFinishedDialog.jsx'

installDialogElementStub()

afterEach(() => {
  cleanup()
  resetDialogElementStubState()
})

const open = (result) => render(
  <ClearFinishedDialog
    targetLabel="tn-sandbox"
    onPreview={vi.fn().mockResolvedValue(result)}
    onExecute={vi.fn()}
    onDone={vi.fn()}
    onClose={vi.fn()}
  />,
)
const warning = async () => (await screen.findByText(/Vão ser excluídos/)).textContent

describe('ClearFinishedDialog: the preview counts the images too', () => {
  it('says the cards and the images that go', async () => {
    open({ cards: 3, imagens: 4 })
    expect(await warning()).toBe('Vão ser excluídos 3 cards concluídos e 4 imagens de tn-sandbox. Isso não pode ser desfeito.')
  })

  it('uses the singular for one image', async () => {
    open({ cards: 1, imagens: 1 })
    expect(await warning()).toBe('Vão ser excluídos 1 card concluído e 1 imagem de tn-sandbox. Isso não pode ser desfeito.')
  })

  it('leaves the images out of the sentence when there are none', async () => {
    open({ cards: 2, imagens: 0 })
    expect(await warning()).toBe('Vão ser excluídos 2 cards concluídos de tn-sandbox. Isso não pode ser desfeito.')
  })
})
