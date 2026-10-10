import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { api } from '../../services/api.js'
import { bootV3 } from './bootV3.jsx'

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('bootV3', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = '<div id="root"></div>'
    delete document.documentElement.dataset.layout
    delete document.documentElement.dataset.theme
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders the placeholder and marks the document as layout v3', async () => {
    vi.spyOn(api, 'fetchAppearance').mockResolvedValue({ theme_mode: 'dark' })
    await act(async () => {
      await bootV3()
    })
    await flush()
    expect(document.documentElement.dataset.layout).toBe('v3')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.getElementById('root').textContent).toContain('TaskNexus V3')
  })

  it('prefers the stored v3 theme over the server appearance', async () => {
    window.localStorage.setItem('tasknexus.v3.theme', 'dark')
    const spy = vi.spyOn(api, 'fetchAppearance').mockResolvedValue({ theme_mode: 'light' })
    await act(async () => {
      await bootV3()
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to light when the appearance request fails', async () => {
    vi.spyOn(api, 'fetchAppearance').mockRejectedValue(new Error('offline'))
    await act(async () => {
      await bootV3()
    })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.layout).toBe('v3')
  })

  it('ignores an invalid stored theme and never writes the appearance', async () => {
    window.localStorage.setItem('tasknexus.v3.theme', 'neon')
    vi.spyOn(api, 'fetchAppearance').mockResolvedValue({ theme_mode: 'bogus' })
    const writer = vi.spyOn(api, 'updateAppearance').mockResolvedValue({})
    await act(async () => {
      await bootV3()
    })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(writer).not.toHaveBeenCalled()
  })
})
