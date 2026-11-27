import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDockWidth, DOCK_MIN_WIDTH } from './useDockWidth.js'

const STORAGE_KEY = 'escritorio:viewer-dock-width'

describe('useDockWidth.setWidth', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.innerWidth = 1600
  })
  afterEach(() => window.localStorage.clear())

  it('clamps, stores and notifies the layout change', () => {
    const onToggled = vi.fn()
    window.addEventListener('escritorio:sidebar-toggled', onToggled)
    const { result } = renderHook(() => useDockWidth())
    expect(typeof result.current.setWidth).toBe('function')

    act(() => result.current.setWidth(700))
    expect(result.current.width).toBe(700)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('700')
    expect(onToggled).toHaveBeenCalledTimes(1)
    window.removeEventListener('escritorio:sidebar-toggled', onToggled)
  })

  it('clamps to the minimum and to 75% of the window', () => {
    const { result } = renderHook(() => useDockWidth())
    act(() => result.current.setWidth(10))
    expect(result.current.width).toBe(DOCK_MIN_WIDTH)
    act(() => result.current.setWidth(5000))
    expect(result.current.width).toBe(1200)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1200')
  })

  it('ignores values that are not finite numbers', () => {
    const { result } = renderHook(() => useDockWidth())
    act(() => result.current.setWidth(700))
    act(() => result.current.setWidth(Number.NaN))
    act(() => result.current.setWidth(undefined))
    expect(result.current.width).toBe(700)
  })

  it('keeps the identity of setWidth across renders', () => {
    const { result, rerender } = renderHook(() => useDockWidth())
    const first = result.current.setWidth
    rerender()
    expect(result.current.setWidth).toBe(first)
  })

  it('does not break when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useDockWidth())
    act(() => result.current.setWidth(640))
    expect(result.current.width).toBe(640)
    spy.mockRestore()
  })
})
