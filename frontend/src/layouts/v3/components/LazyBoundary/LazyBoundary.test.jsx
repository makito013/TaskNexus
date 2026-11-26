import { describe, it, expect, vi, afterEach } from 'vitest'
import { lazy } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import LazyBoundary from './LazyBoundary.jsx'

describe('LazyBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the placeholder while the chunk loads and the screen once it arrives', async () => {
    const Screen = lazy(() => Promise.resolve({ default: () => <p>Pronto</p> }))
    render(<LazyBoundary label="Carregando o board…"><Screen /></LazyBoundary>)
    expect(screen.getByText('Carregando o board…')).toBeTruthy()
    expect(await screen.findByText('Pronto')).toBeTruthy()
    expect(screen.queryByText('Carregando o board…')).toBeNull()
  })

  it('the placeholder is not a live region', () => {
    const Never = lazy(() => new Promise(() => {}))
    render(<LazyBoundary><Never /></LazyBoundary>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a chunk that fails shows "Não carregou." with a reload button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onReload = vi.fn()
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<LazyBoundary onReload={onReload}><Broken /></LazyBoundary>)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não carregou.')
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
