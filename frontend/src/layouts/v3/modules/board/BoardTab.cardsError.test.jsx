// The cards of the current filter could not be read (first read, or a change of project during an
// outage), and a project that left the options. Same setup as BoardTab.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import BoardTab from './BoardTab.jsx'
import { CARDS, COLUMNS, registry } from './boardFixtures.js'

const index = registry()
const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const titlesIn = (name) => within(column(name)).queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
const select = (name) => screen.getByRole('combobox', { name })
const loaded = () => screen.findByRole('region', { name: 'Board' })

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('BoardTab: the cards of the filter could not be read', () => {
  it('(a) a first read that fails shows the error with "Tentar de novo", not a loading, and a good read clears it', async () => {
    const fetchCards = vi.spyOn(api, 'fetchCards').mockRejectedValue(new Error('500'))
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui carregar os cards.')
    expect(screen.queryByLabelText('Carregando cards')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Coluna A fazer' })).toBeNull()

    fetchCards.mockResolvedValue(CARDS)
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await waitFor(() => expect(titlesIn('A fazer')).toContain('Card 1'))
  })

  it('(a) the poll recovers it by itself, with no click', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      const fetchCards = vi.spyOn(api, 'fetchCards').mockRejectedValueOnce(new Error('500')).mockResolvedValue(CARDS)
      render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByRole('alert').textContent).toContain('Não consegui carregar os cards.')
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(fetchCards).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('(b) changing the project during an outage ends in the error, never in an endless loading', async () => {
    const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    render(<BoardTab registry={index} workspaceKey="Pessoal" showArchived={false} />)
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))

    fetchCards.mockRejectedValue(new Error('down'))
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/tn-sandbox' } })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui carregar os cards.')
    expect(screen.queryByLabelText('Carregando cards')).toBeNull()
    // the toolbar stays usable: another option is an error too until a read works
    fireEvent.change(select('Projeto'), { target: { value: '' } })
    await screen.findByRole('alert')

    fetchCards.mockResolvedValue(CARDS)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))
  })

  it('an error that comes after good data stays the quiet chip, not the panel', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValueOnce(CARDS)
      render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      fetchCards.mockRejectedValueOnce(new Error('500'))
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(within(screen.getByRole('group', { name: 'Filtros do board' })).getByRole('status').textContent).toBe('Sem atualizar agora')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BoardTab: a project that left the options', () => {
  it('an archived project chosen with "Mostrar arquivados" on stops narrowing when it is turned off', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    const props = { registry: index, workspaceKey: 'Pessoal' }
    const view = render(<BoardTab {...props} showArchived />)
    await loaded()
    fireEvent.change(select('Projeto'), { target: { value: 'Pessoal/old' } })
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 7']))
    view.rerender(<BoardTab {...props} showArchived={false} />)
    expect(select('Projeto').value).toBe('')
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith([]))
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3']))
    expect(screen.queryByText('Nenhum card com esses filtros.')).toBeNull()
  })
})
