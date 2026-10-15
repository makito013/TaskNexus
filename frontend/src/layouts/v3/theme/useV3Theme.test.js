import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { api } from '../../../services/api.js'
import { THEME_STORAGE_KEY, useV3Theme } from './useV3Theme.js'

describe('useV3Theme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('prefers the theme stored in localStorage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'light' }))
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to the appearance theme_mode', () => {
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'dark' }))
    expect(result.current.theme).toBe('dark')
  })

  it('falls back to light when nothing is known', () => {
    const { result } = renderHook(() => useV3Theme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('ignores a stored value that is not a theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'dark' }))
    expect(result.current.theme).toBe('dark')
  })

  it('toggle flips data-theme and persists to localStorage', () => {
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'light' }))
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    act(() => result.current.toggleTheme())
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('keeps working when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'dark' }))
    expect(result.current.theme).toBe('dark')
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('never calls updateAppearance', () => {
    const writer = vi.spyOn(api, 'updateAppearance').mockResolvedValue({})
    const { result } = renderHook(() => useV3Theme({ initialTheme: 'light' }))
    act(() => result.current.toggleTheme())
    expect(writer).not.toHaveBeenCalled()
  })
})
