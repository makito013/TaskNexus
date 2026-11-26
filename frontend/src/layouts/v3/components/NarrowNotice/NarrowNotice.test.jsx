import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import Dialog from '../Dialog/Dialog.jsx'
import NarrowNotice, { NARROW_WINDOW_QUERY, useNarrowWindow } from './NarrowNotice.jsx'

installDialogElementStub()

// A matchMedia whose answer the test can change.
function installMatchMedia(initial) {
  const state = { narrow: initial, listeners: new Set() }
  window.matchMedia = (query) => ({
    media: query,
    get matches() { return query === NARROW_WINDOW_QUERY ? state.narrow : false },
    addEventListener: (_type, listener) => state.listeners.add(listener),
    removeEventListener: (_type, listener) => state.listeners.delete(listener),
  })
  return {
    setNarrow(value) {
      state.narrow = value
      for (const listener of [...state.listeners]) listener({ matches: value })
    },
  }
}

function Probe({ withDialog = false }) {
  const narrow = useNarrowWindow()
  return (
    <>
      <p>{narrow ? 'narrow' : 'wide'}</p>
      {withDialog && <Dialog open title="Aberto" titleId="n1" onClose={() => {}}><p>corpo</p></Dialog>}
    </>
  )
}

describe('NarrowNotice', () => {
  beforeEach(() => resetDialogElementStubState())
  afterEach(() => { delete window.matchMedia })

  it('says "Abra no computador" with no button and no link', () => {
    render(<NarrowNotice />)
    expect(screen.getByRole('heading', { name: 'Abra no computador' })).toBeTruthy()
    expect(screen.getByText(/pelo menos 1024 px de largura/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses the (max-width: 1023px) query, so 1024 is not narrow', () => {
    expect(NARROW_WINDOW_QUERY).toBe('(max-width: 1023px)')
  })

  it('is not narrow when matchMedia does not exist (jsdom)', () => {
    render(<Probe />)
    expect(screen.getByText('wide')).toBeTruthy()
  })

  it('follows the window when no modal is open', () => {
    const media = installMatchMedia(false)
    render(<Probe />)
    expect(screen.getByText('wide')).toBeTruthy()
    act(() => media.setNarrow(true))
    expect(screen.getByText('narrow')).toBeTruthy()
    act(() => media.setNarrow(false))
    expect(screen.getByText('wide')).toBeTruthy()
  })

  it('waits for the open modal to close before swapping to the notice', () => {
    const media = installMatchMedia(false)
    const { rerender } = render(<Probe withDialog />)
    act(() => media.setNarrow(true))
    expect(screen.getByText('wide')).toBeTruthy()
    rerender(<Probe withDialog={false} />)
    expect(screen.getByText('narrow')).toBeTruthy()
  })
})
