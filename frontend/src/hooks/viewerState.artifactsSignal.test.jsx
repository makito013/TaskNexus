import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderHook, act } from '@testing-library/react'
import { ViewerProvider, useViewer, useViewerActions } from './viewerState.jsx'

function setup() {
  const wrapper = ({ children }) => createElement(ViewerProvider, null, children)
  return renderHook(() => ({ viewer: useViewer(), actions: useViewerActions() }), { wrapper })
}

describe('notifyArtifactsChanged', () => {
  it('raises artifactsSignal by one per call and touches nothing else', () => {
    const { result } = setup()
    expect(result.current.viewer.artifactsSignal).toBe(0)
    const before = result.current.viewer
    act(() => result.current.actions.notifyArtifactsChanged())
    expect(result.current.viewer.artifactsSignal).toBe(1)
    act(() => result.current.actions.notifyArtifactsChanged())
    expect(result.current.viewer.artifactsSignal).toBe(2)
    expect(result.current.viewer.scopes).toBe(before.scopes)
    expect(result.current.viewer.surfaces).toBe(before.surfaces)
    expect(result.current.viewer.unseen).toBe(before.unseen)
    expect(result.current.viewer.toast).toBeNull()
  })

  it('has a stable identity and is exposed by both hooks', () => {
    const { result, rerender } = setup()
    const first = result.current.actions.notifyArtifactsChanged
    act(() => first())
    rerender()
    expect(result.current.actions.notifyArtifactsChanged).toBe(first)
    expect(result.current.viewer.notifyArtifactsChanged).toBe(first)
  })

  it('the opening of an artifact file still raises the signal by itself', () => {
    const { result } = setup()
    act(() => result.current.actions.receiveOpen('P/x::a', { id: 1, path: 'docs/a.md', title: 'a.md' }))
    expect(result.current.viewer.artifactsSignal).toBe(1)
    act(() => result.current.actions.notifyArtifactsChanged())
    expect(result.current.viewer.artifactsSignal).toBe(2)
  })
})
