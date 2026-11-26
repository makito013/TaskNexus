import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Dialog from './Dialog.jsx'
import { pushModal, subscribeModals, topModal, useTopModal } from './modalStack.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'

installDialogElementStub()

function Probe() {
  const top = useTopModal()
  return <p>{top ? top.getAttribute('data-name') : 'none'}</p>
}

describe('modalStack', () => {
  const released = []
  afterEach(() => {
    while (released.length) released.pop()()
  })

  const push = (name) => {
    const element = document.createElement('div')
    element.setAttribute('data-name', name)
    const release = pushModal(element)
    released.push(release)
    return { element, release }
  }

  it('is empty at the start', () => {
    expect(topModal()).toBeNull()
  })

  it('returns the last pushed modal and falls back to the previous one on release', () => {
    const first = push('first')
    const second = push('second')
    expect(topModal()).toBe(second.element)
    second.release()
    expect(topModal()).toBe(first.element)
    first.release()
    expect(topModal()).toBeNull()
  })

  it('releasing twice removes nothing else', () => {
    const first = push('first')
    const second = push('second')
    second.release()
    second.release()
    expect(topModal()).toBe(first.element)
  })

  it('releasing a modal that is not on top keeps the top one', () => {
    const first = push('first')
    const second = push('second')
    first.release()
    expect(topModal()).toBe(second.element)
  })

  it('notifies subscribers on push and release, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeModals(listener)
    const { release } = push('a')
    release()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    push('b')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('useTopModal follows the stack', () => {
    render(<Probe />)
    expect(screen.getByText('none')).toBeTruthy()
  })
})

describe('Dialog registration', () => {
  beforeEach(() => resetDialogElementStubState())

  it('registers the open dialog on the stack and releases it when it closes', () => {
    const { rerender } = render(<Dialog open title="Um" titleId="d1" onClose={() => {}}><p>corpo</p></Dialog>)
    const top = topModal()
    expect(top).not.toBeNull()
    expect(top.tagName).toBe('DIALOG')
    rerender(<Dialog open={false} title="Um" titleId="d1" onClose={() => {}}><p>corpo</p></Dialog>)
    expect(topModal()).toBeNull()
  })

  it('the second dialog is on top and the first returns when it closes', () => {
    render(
      <>
        <Dialog open title="Um" titleId="d1" onClose={() => {}}><p>um</p></Dialog>
        <Dialog open title="Dois" titleId="d2" onClose={() => {}}><p>dois</p></Dialog>
      </>,
    )
    expect(topModal().getAttribute('aria-labelledby')).toBe('d2')
  })
})
