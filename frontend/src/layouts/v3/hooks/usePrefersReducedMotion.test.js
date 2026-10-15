import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.js'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia
  else delete window.matchMedia
})

describe('usePrefersReducedMotion', () => {
  it('returns false when matchMedia is unavailable', () => {
    delete window.matchMedia
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when the media query matches', () => {
    const queries = []
    window.matchMedia = (query) => {
      queries.push(query)
      return { matches: true, addEventListener() {}, removeEventListener() {} }
    }
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
    expect(queries).toContain('(prefers-reduced-motion: reduce)')
  })
})
