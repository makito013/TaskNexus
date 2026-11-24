import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import StatusBanner, { describeBanner } from './StatusBanner.jsx'

afterEach(cleanup)

describe('history_import_failed banner', () => {
  const banner = { kind: 'history_import_failed', reason: 'unreadable' }

  it('offers "Ver no terminal" when the screen can open the terminal', () => {
    const onAction = vi.fn()
    render(<StatusBanner banner={banner} connection={{ state: 'open' }} canOpenTerminal onAction={onAction} />)
    expect(screen.getByText('Não foi possível importar o histórico')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver no terminal' }))
    expect(onAction).toHaveBeenCalledWith('open_terminal')
  })

  it('offers no action when the screen cannot open the terminal', () => {
    expect(describeBanner(banner, { canOpenTerminal: false }).actions).toEqual([])
    render(<StatusBanner banner={banner} connection={{ state: 'open' }} onAction={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the label of the other banners', () => {
    expect(describeBanner({ kind: 'engine_unavailable' }, { canOpenTerminal: true }).actions).toEqual([
      { id: 'open_terminal', label: 'Abrir no terminal' },
    ])
  })
})
