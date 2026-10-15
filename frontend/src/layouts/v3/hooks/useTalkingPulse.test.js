import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { TALK_DURATION_MS, useTalkingPulse } from './useTalkingPulse.js'

describe('useTalkingPulse', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps talking for the pulse duration and then settles to idle', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTalkingPulse('talking', 'Oi'))
    expect(result.current).toBe('talking')
    act(() => { vi.advanceTimersByTime(TALK_DURATION_MS - 1) })
    expect(result.current).toBe('talking')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('idle')
  })

  it('talks again when the phrase changes', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ message }) => useTalkingPulse('talking', message), {
      initialProps: { message: 'Primeira' },
    })
    act(() => { vi.advanceTimersByTime(TALK_DURATION_MS) })
    expect(result.current).toBe('idle')
    rerender({ message: 'Segunda' })
    expect(result.current).toBe('talking')
  })

  it('returns every other state untouched', () => {
    const { result } = renderHook(() => useTalkingPulse('alert', 'Atenção'))
    expect(result.current).toBe('alert')
  })
})
