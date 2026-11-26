// Where the keyboard focus goes when "Tentar de novo" brings the board back (the button that had
// it leaves with the error panel).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import BoardTab from './BoardTab.jsx'
import { CARDS, COLUMNS, registry } from './boardFixtures.js'

const index = registry()

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('BoardTab: focus after "Tentar de novo"', () => {
  it('goes to the board when the cards come back', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    const fetchCards = vi.spyOn(api, 'fetchCards').mockRejectedValue(new Error('500'))
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: 'Tentar de novo' })
    retry.focus()
    fetchCards.mockResolvedValue(CARDS)
    fireEvent.click(retry)
    const board = await screen.findByRole('region', { name: 'Board' })
    await waitFor(() => expect(document.activeElement).toBe(board))
  })

  it('goes to the board when the columns come back', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    vi.spyOn(api, 'fetchBoardColumns').mockRejectedValueOnce(new Error('down')).mockResolvedValue(COLUMNS)
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: 'Tentar de novo' })
    retry.focus()
    fireEvent.click(retry)
    const board = await screen.findByRole('region', { name: 'Board' })
    await waitFor(() => expect(document.activeElement).toBe(board))
  })

  it('stays on the button while the read still fails', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockRejectedValue(new Error('500'))
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: 'Tentar de novo' })
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() => expect(retry.getAttribute('aria-busy')).toBeNull())
    expect(document.activeElement).toBe(retry)
  })

  it('does not steal the focus when the poll brings the board back by itself', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockRejectedValueOnce(new Error('500')).mockResolvedValue(CARDS)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await screen.findByRole('alert')
    outside.focus()
    await screen.findByRole('region', { name: 'Board' }, { timeout: 7000 })
    expect(document.activeElement).toBe(outside)
    outside.remove()
  }, 15000)
})
