import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { topModal } from '../../components/Dialog/modalStack.js'
import { contentBody, createHarness, jsonResponse, probe } from '../viewer/viewerTestKit.jsx'
import BoardTab from './BoardTab.jsx'
import { COLUMNS, card, registry } from './boardFixtures.js'

installDialogElementStub()
const { stubFetch, renderWithShell } = createHarness({ vi, render })

const SCOPE = 'card-attachments'
const attachment = (id, filename, size = 2048) => ({ id, card_id: 1, filename, size_bytes: size, created_at: 1700000000 + id })
const ATTACHMENTS = [attachment(7, 'plan.md'), attachment(8, 'pack.zip'), attachment(9, 'page.html')]
const index = registry()

const fullscreen = () => document.querySelector('dialog.v3-viewer-fullscreen')
const cardDialog = () => screen.getByRole('dialog', { name: 'Card 1' })
const attachmentsRegion = () => within(cardDialog()).getByRole('region', { name: /^Anexos/ })
const seeButton = (name) => within(cardDialog()).getByRole('button', { name: `Ver ${name}` })

async function mountBoard({ attachments = ATTACHMENTS, extraRoutes = [] } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue([card(1, 'Pessoal/tn-sandbox', { attachments })])
  stubFetch([
    ['/api/card-attachments/7/content', jsonResponse(contentBody({ name: 'plan.md', text: '# Attached plan\n\n[next](next.md)' }))],
    ['/api/card-attachments/9/content', jsonResponse(contentBody({ name: 'page.html', kind: 'html', text: '<p>page</p>' }))],
    ...extraRoutes,
  ])
  renderWithShell(<BoardTab registry={index} workspaceKey="" showArchived={false} />, { activeSessionKey: null })
  const open = await screen.findByRole('button', { name: /Card 1/ })
  fireEvent.click(open)
  await screen.findByRole('dialog', { name: 'Card 1' })
}

beforeEach(() => {
  localStorage.clear()
  resetDialogElementStubState()
  clearViewerContentCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('card attachments in the full-screen viewer', () => {
  it('"Ver" opens the file in a full screen of its own, above the card dialog and outside of it', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    expect(await screen.findByText('Attached plan')).toBeTruthy()
    expect(fullscreen().open).toBe(true)
    expect(fullscreen().parentElement).toBe(document.body)
    expect(cardDialog().contains(fullscreen())).toBe(false)
    expect(cardDialog().open).toBe(true)
    expect(topModal()).toBe(fullscreen())
    expect(probe.viewer.getSurface(SCOPE).open).toBe(true)
    expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual([7])
  })

  it('Esc closes only the viewer, the focus goes back to "Ver", and a second Esc closes the card dialog', async () => {
    await mountBoard()
    const see = seeButton('plan.md')
    fireEvent.click(see)
    await screen.findByText('Attached plan')

    fireEvent.keyDown(fullscreen(), { key: 'Escape' })
    expect(fullscreen()).toBeNull()
    expect(cardDialog().open).toBe(true)
    expect(probe.viewer.getSurface(SCOPE).open).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(see))

    fireEvent.keyDown(cardDialog(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Card 1' })).toBeNull())
  })

  it('"✕ Fechar" closes the viewer and keeps the card dialog', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    await screen.findByText('Attached plan')
    fireEvent.click(within(fullscreen()).getByRole('button', { name: '✕ Fechar' }))
    expect(fullscreen()).toBeNull()
    expect(cardDialog().open).toBe(true)
  })

  it('closing the card dialog empties the scope of its attachments', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    await screen.findByText('Attached plan')
    fireEvent.keyDown(fullscreen(), { key: 'Escape' })
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1)
    fireEvent.click(within(cardDialog()).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Card 1' })).toBeNull())
    expect(probe.viewer.getScope(SCOPE).items).toEqual([])
    expect(probe.viewer.getSurface(SCOPE).open).toBe(false)
  })

  it('a relative link inside an attached Markdown is a toast in the viewer, not a navigation', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    fireEvent.click(await screen.findByRole('link', { name: 'next' }))
    const toast = await screen.findByText('Links para outros arquivos não funcionam em anexos.')
    // the toast is drawn inside the modal on top (a modal makes everything behind it inert)
    expect(fullscreen().contains(toast)).toBe(true)
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1)
  })

  it('removing a file whose tab is still open closes the tab', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    await screen.findByText('Attached plan')
    fireEvent.keyDown(fullscreen(), { key: 'Escape' })
    expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual([7])
    vi.spyOn(api, 'deleteCardAttachment').mockResolvedValue({ success: true })
    fireEvent.click(within(cardDialog()).getByRole('button', { name: 'Remover plan.md' }))
    await waitFor(() => expect(api.deleteCardAttachment).toHaveBeenCalledWith(1, 7))
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items).toEqual([]))
    expect(within(cardDialog()).queryByText('plan.md')).toBeNull()
  })

  it('a failed removal keeps the file and its tab and says so in the section', async () => {
    await mountBoard()
    fireEvent.click(seeButton('plan.md'))
    await screen.findByText('Attached plan')
    fireEvent.keyDown(fullscreen(), { key: 'Escape' })
    vi.spyOn(api, 'deleteCardAttachment').mockRejectedValue(new Error('Falha ao remover anexo'))
    fireEvent.click(within(cardDialog()).getByRole('button', { name: 'Remover plan.md' }))
    expect((await within(cardDialog()).findByRole('alert')).textContent).toBe('Não consegui remover o anexo.')
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1)
    expect(within(cardDialog()).getByText('plan.md')).toBeTruthy()
  })

  it('a type without a preview offers only "Baixar", a real download link', async () => {
    await mountBoard()
    const dialog = cardDialog()
    expect(within(dialog).queryByRole('button', { name: 'Ver pack.zip' })).toBeNull()
    const download = within(dialog).getByRole('link', { name: 'Baixar pack.zip' })
    expect(download.getAttribute('href')).toBe('/api/card-attachments/8/f/pack.zip?download=1')
    expect(download.hasAttribute('download')).toBe(true)
  })

  it('an HTML attachment opens in the viewer by the kind the server answers, not by the extension', async () => {
    await mountBoard()
    fireEvent.click(seeButton('page.html'))
    await waitFor(() => expect(fullscreen().querySelector('iframe')).not.toBeNull())
    expect(probe.viewer.getScope(SCOPE).items[0].source).toBe('card_attachment')
  })

  it('the 11th attachment is refused: the add button is unavailable, says 10/10 and opens no picker', async () => {
    const ten = Array.from({ length: 10 }, (_, number) => attachment(100 + number, `f${number}.md`))
    await mountBoard({ attachments: ten })
    const dialog = cardDialog()
    expect(within(dialog).getByRole('heading', { name: 'Anexos (10/10)' })).toBeTruthy()
    const add = within(dialog).getByRole('button', { name: 'Anexar arquivo' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(within(dialog).getByText('10/10 anexos')).toBeTruthy()
    const input = attachmentsRegion().querySelector('input[type="file"]')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(add)
    expect(click).not.toHaveBeenCalled()
  })

  it('an upload from the dialog goes through the board data and shows up in the list', async () => {
    await mountBoard({ attachments: [] })
    vi.spyOn(api, 'uploadCardAttachment').mockResolvedValue(attachment(30, 'new.md'))
    const input = attachmentsRegion().querySelector('input[type="file"]')
    const file = new File(['hi'], 'new.md')
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    await waitFor(() => expect(api.uploadCardAttachment).toHaveBeenCalledWith(1, file))
    expect(await within(cardDialog()).findByRole('heading', { name: 'Anexos (1/10)' })).toBeTruthy()
  })
})
