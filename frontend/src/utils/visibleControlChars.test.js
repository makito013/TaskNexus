import { describe, it, expect } from 'vitest'
import { hasInvisibleChars, markInvisibleChars } from './visibleControlChars.js'

describe('markInvisibleChars', () => {
  it('shows the right-to-left override as a visible marker and keeps the rest of the text', () => {
    expect(markInvisibleChars('cat ‮txt.exe')).toBe('cat ⟦U+202E⟧txt.exe')
  })

  it.each([
    ['‪', 'U+202A'], ['‫', 'U+202B'], ['‬', 'U+202C'], ['‭', 'U+202D'], ['‮', 'U+202E'],
    ['⁦', 'U+2066'], ['⁧', 'U+2067'], ['⁨', 'U+2068'], ['⁩', 'U+2069'],
    ['​', 'U+200B'], ['‌', 'U+200C'], ['‍', 'U+200D'], ['‎', 'U+200E'], ['‏', 'U+200F'],
    ['﻿', 'U+FEFF'], ['⁠', 'U+2060'], ['؜', 'U+061C'], ['­', 'U+00AD'], ['\u0000', 'U+0000'],
    ['\u001B', 'U+001B'], ['\u007F', 'U+007F'], ['\u0085', 'U+0085'], [' ', 'U+2028'],
    ['\u{E0041}', 'U+E0041'],
  ])('marks %j as %s', (char, code) => {
    expect(markInvisibleChars(`a${char}b`)).toBe(`a⟦${code}⟧b`)
    expect(hasInvisibleChars(`a${char}b`)).toBe(true)
  })

  it('leaves ordinary text, tabs, line breaks and accents alone', () => {
    const text = 'git commit -m "ação"\n\tls -la\r\n'
    expect(markInvisibleChars(text)).toBe(text)
    expect(hasInvisibleChars(text)).toBe(false)
  })

  it('marks every occurrence, also when called repeatedly', () => {
    expect(markInvisibleChars('‮‮')).toBe('⟦U+202E⟧⟦U+202E⟧')
    expect(hasInvisibleChars('‮')).toBe(true)
    expect(hasInvisibleChars('‮')).toBe(true)
  })

  it('passes a non-string through', () => {
    expect(markInvisibleChars(null)).toBeNull()
    expect(hasInvisibleChars(undefined)).toBe(false)
  })
})
