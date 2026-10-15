import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved with path (not `new URL(..., import.meta.url)`): Vite rewrites that literal
// form into an asset reference.
const here = path.dirname(fileURLToPath(import.meta.url))
const fontsCss = readFileSync(path.join(here, 'fonts.css'), 'utf8')
const publicDir = path.resolve(here, '..', '..', '..', '..', 'public')

// Comments mention the Google origin on purpose; only declarations count here.
const declarations = fontsCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('v3 fonts', () => {
  it('every font file referenced by fonts.css exists in public/fonts', () => {
    const urls = [...declarations.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1])
    expect(urls.length).toBeGreaterThanOrEqual(3)
    for (const url of urls) {
      const file = `${publicDir}${url}`
      expect(existsSync(file), url).toBe(true)
      expect(statSync(file).size, url).toBeGreaterThan(5000)
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), url).toBe('wOF2')
    }
  })

  it('fonts.css never references a remote host', () => {
    expect(declarations).not.toMatch(/https?:\/\//)
    expect(declarations).not.toMatch(/googleapis|gstatic/)
  })

  it('declares Plex Mono 500 so the v3 chunk does not depend on the v2 theme', () => {
    expect(declarations).toMatch(/font-family: 'IBM Plex Mono';[\s\S]*?font-weight: 500;[\s\S]*?ibm-plex-mono-500\.woff2/)
  })

  it('declares the display and sans families used by the tokens', () => {
    expect(declarations).toContain("font-family: 'Bricolage Grotesque';")
    expect(declarations).toContain("font-family: 'IBM Plex Sans';")
  })

  it('ships the OFL license text next to the font files', () => {
    for (const name of ['OFL-bricolage-grotesque.txt', 'OFL-ibm-plex.txt', 'OFL-figtree.txt']) {
      expect(readFileSync(`${publicDir}/fonts/${name}`, 'utf8')).toContain('SIL Open Font License, Version 1.1')
    }
  })
})
