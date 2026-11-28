// QA additions for the tablist of Projetos: keyboard wrap-around, the roving tab stop and keys that must
// be left alone.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ProjectTabs from './ProjectTabs.jsx'

function Harness({ initial = 'agents', onSelect = () => {} }) {
  const [tab, setTab] = useState(initial)
  return <ProjectTabs tab={tab} onSelect={(id) => { onSelect(id); setTab(id) }} />
}
const tabs = () => screen.getAllByRole('tab')
const names = () => tabs().map((node) => node.textContent)

describe('ProjectTabs QA: keyboard', () => {
  it('offers the four tabs in the documented order', () => {
    render(<Harness />)
    expect(names()).toEqual(['Agentes', 'Sessões', 'Board', 'Artefatos'])
  })

  it('ArrowLeft on the first tab wraps to the last and selects it', () => {
    render(<Harness />)
    act(() => tabs()[0].focus())
    fireEvent.keyDown(tabs()[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs()[3])
    expect(tabs()[3].getAttribute('aria-selected')).toBe('true')
  })

  it('ArrowRight on the last tab wraps to the first and selects it', () => {
    render(<Harness initial="artifacts" />)
    act(() => tabs()[3].focus())
    fireEvent.keyDown(tabs()[3], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs()[0])
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('exactly one tab is a tab stop, and it is the selected one while the focus is outside', () => {
    render(<Harness initial="board" />)
    expect(tabs().map((node) => node.tabIndex)).toEqual([-1, -1, 0, -1])
  })

  it('the tab stop goes back to the selected tab when the focus leaves the list', () => {
    render(<Harness initial="board" />)
    act(() => tabs()[0].focus())
    expect(tabs().map((node) => node.tabIndex)).toEqual([0, -1, -1, -1])
    fireEvent.blur(tabs()[0].parentElement, { relatedTarget: document.body })
    expect(tabs().map((node) => node.tabIndex)).toEqual([-1, -1, 0, -1])
  })

  it('only the selected tab points at the panel', () => {
    render(<Harness initial="board" />)
    expect(tabs().map((node) => node.getAttribute('aria-controls'))).toEqual([null, null, 'projects-tabpanel', null])
  })

  it('Enter and Space select the focused tab and stop the default action', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const board = tabs()[2]
    act(() => board.focus())
    const enterAllowed = fireEvent.keyDown(board, { key: 'Enter' })
    const spaceAllowed = fireEvent.keyDown(board, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenCalledWith('board')
    expect(enterAllowed).toBe(false)
    expect(spaceAllowed).toBe(false)
  })

  it('leaves Tab and letters alone: no selection and the default action is not prevented', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    act(() => tabs()[0].focus())
    expect(fireEvent.keyDown(tabs()[0], { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(tabs()[0], { key: 'a' })).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Home and End jump to the first and last tab', () => {
    render(<Harness initial="board" />)
    act(() => tabs()[2].focus())
    fireEvent.keyDown(tabs()[2], { key: 'End' })
    expect(document.activeElement).toBe(tabs()[3])
    fireEvent.keyDown(tabs()[3], { key: 'Home' })
    expect(document.activeElement).toBe(tabs()[0])
  })
})
