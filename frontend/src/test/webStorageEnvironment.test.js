// Regression test for a Vitest 4 + Node 25+ environment bug, not a product
// bug. Do NOT mock window.localStorage/window.sessionStorage here — the whole
// point of this file is to prove the REAL jsdom Storage implementation works
// under the current Node/Vitest combo, so mocking would defeat its purpose.
//
// Mechanism: Node 25+ ships a native Web Storage implementation that is ON BY
// DEFAULT (opt-out via `--no-experimental-webstorage`; in Node 22/24 it was
// opt-in via `--experimental-webstorage` and therefore off by default, which
// is why this never broke on those versions). That native `localStorage`
// throws/returns undefined for its methods unless the CLI is also given
// `--localstorage-file`, which Vitest never passes.
//
// Vitest 4's jsdom environment setup (`populateGlobal`, in
// node_modules/vitest/dist/chunks/index.DC7d2Pf8.js) copies jsdom's `window`
// properties onto the Node global through a fixed allowlist (`KEYS`/
// `OTHER_KEYS`). That allowlist includes the `Storage` class but NOT the
// `localStorage`/`sessionStorage` INSTANCES. Its `getWindowKeys` helper also
// skips any key that already exists on the Node global — and because Node
// 25+ already defines `localStorage`/`sessionStorage` globally (broken as
// they are), jsdom's working instances are discarded instead of overwriting
// them. Net effect: both bare `localStorage` and `window.localStorage`
// resolve to the same broken Node object, and calling any method on it blows
// up with `TypeError: Cannot read properties of undefined (reading
// 'removeItem')` (or similar) in application code that never touched Node's
// Web Storage on purpose.
//
// Confirmed to have no fix in Vitest 4.x: the allowlist is unchanged even in
// 4.1.10 (latest stable at the time of writing), and the upstream fix only
// landed in Vitest 5 (a breaking major). See vitest-dev/vitest#10867 (the
// original report) and the rejected 4.x backport vitest-dev/vitest#10873.
//
// The actual fix lives in frontend/vite.config.js (`test.execArgv`), which
// re-disables Node's native Web Storage on Node 25+ so jsdom's copy is never
// shadowed in the first place. This file only proves that fix works end to
// end via a real round-trip — it exercises no application code.
import { describe, it, expect, afterEach } from 'vitest'

describe('window storage APIs (Node 25+ compatibility)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('persists and clears values via window.localStorage', () => {
    window.localStorage.setItem('probe-key', 'probe-value')
    expect(window.localStorage.getItem('probe-key')).toBe('probe-value')

    window.localStorage.removeItem('probe-key')
    expect(window.localStorage.getItem('probe-key')).toBeNull()

    window.localStorage.setItem('a', '1')
    window.localStorage.setItem('b', '2')
    window.localStorage.clear()
    expect(window.localStorage.getItem('a')).toBeNull()
    expect(window.localStorage.getItem('b')).toBeNull()
  })

  it('persists and clears values via window.sessionStorage', () => {
    window.sessionStorage.setItem('probe-key', 'probe-value')
    expect(window.sessionStorage.getItem('probe-key')).toBe('probe-value')

    window.sessionStorage.removeItem('probe-key')
    expect(window.sessionStorage.getItem('probe-key')).toBeNull()

    window.sessionStorage.setItem('a', '1')
    window.sessionStorage.setItem('b', '2')
    window.sessionStorage.clear()
    expect(window.sessionStorage.getItem('a')).toBeNull()
    expect(window.sessionStorage.getItem('b')).toBeNull()
  })

  it('exposes the same working storage instance on the bare global and on window', () => {
    // This is the exact assertion that fails under the bug: bare `localStorage`
    // and `window.localStorage` both point at Node's broken native instance
    // instead of jsdom's, so they ARE already "the same object" — just the
    // wrong one. Round-tripping through the bare global is what proves it is
    // the working jsdom instance, not merely that the two references match.
    localStorage.setItem('bare-global-probe', 'yes')
    expect(window.localStorage.getItem('bare-global-probe')).toBe('yes')
    localStorage.removeItem('bare-global-probe')
  })
})
