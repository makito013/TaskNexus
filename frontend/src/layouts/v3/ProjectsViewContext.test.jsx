import { describe, it, expect } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { ProjectsViewProvider, useProjectsView } from './ProjectsViewContext.jsx'

describe('ProjectsViewContext', () => {
  it('starts on the Agentes tab with no workspace, archived hidden and nothing known', () => {
    const { result } = renderHook(() => useProjectsView(), { wrapper: ProjectsViewProvider })
    expect(result.current).toMatchObject({
      tab: 'agents', workspaceKey: '', showArchived: false, unassignedKnown: null,
    })
  })

  it('works without a provider, with state local to the caller', () => {
    const { result } = renderHook(() => useProjectsView())
    act(() => { result.current.setTab('board'); result.current.setWorkspaceKey('Pessoal') })
    expect(result.current.tab).toBe('board')
    expect(result.current.workspaceKey).toBe('Pessoal')
  })

  it('two callers without a provider do not share state', () => {
    const first = renderHook(() => useProjectsView())
    const second = renderHook(() => useProjectsView())
    act(() => first.result.current.setTab('board'))
    expect(second.result.current.tab).toBe('agents')
  })

  it('shares one state between the consumers of a provider', () => {
    const first = {}
    const second = {}
    function A() { Object.assign(first, useProjectsView()); return null }
    function B() { Object.assign(second, useProjectsView()); return null }
    render(<ProjectsViewProvider><A /><B /></ProjectsViewProvider>)
    act(() => first.setWorkspaceKey('podesubir'))
    expect(second.workspaceKey).toBe('podesubir')
  })

  it('survives the unmount of the screen: a remount under the same provider finds the same view', () => {
    let latest
    function Screen() { latest = useProjectsView(); return <p>screen</p> }
    function Host() {
      const [show, setShow] = useState(true)
      return (
        <ProjectsViewProvider>
          <button onClick={() => setShow((value) => !value)}>toggle</button>
          {show && <Screen />}
        </ProjectsViewProvider>
      )
    }
    const { getByText } = render(<Host />)
    act(() => { latest.setTab('board'); latest.setWorkspaceKey('Pessoal'); latest.setShowArchived(true); latest.setUnassignedKnown(true) })
    act(() => getByText('toggle').click())
    act(() => getByText('toggle').click())
    expect(latest).toMatchObject({ tab: 'board', workspaceKey: 'Pessoal', showArchived: true, unassignedKnown: true })
  })

  it('does not write to web storage', () => {
    const before = localStorage.length + sessionStorage.length
    const { result } = renderHook(() => useProjectsView(), { wrapper: ProjectsViewProvider })
    act(() => { result.current.setTab('board'); result.current.setWorkspaceKey('Pessoal') })
    expect(localStorage.length + sessionStorage.length).toBe(before)
  })

  it('keeps the setters stable while the view changes', () => {
    const { result } = renderHook(() => useProjectsView(), { wrapper: ProjectsViewProvider })
    const { setTab } = result.current
    act(() => result.current.setTab('board'))
    expect(result.current.setTab).toBe(setTab)
  })
})
