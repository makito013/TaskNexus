import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { api } from '../../services/api.js'
import { APPEARANCE_TIMEOUT_MS, bootV3 } from './bootV3.jsx'

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

  it('renders the shell and marks the document as layout v3', async () => {
    vi.spyOn(api, 'fetchAppearance').mockResolvedValue({ theme_mode: 'dark' })
    await act(async () => {
      await bootV3()
    })
    await flush()
    expect(document.documentElement.dataset.layout).toBe('v3')
    expect(document.documentElement.dataset.theme).toBe('dark')
    const root = document.getElementById('root')
    expect(root.querySelector('nav[aria-label="Módulos"]')).toBeTruthy()
    expect(root.querySelector('.v3-island')).toBeTruthy()
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

  it('falls back to light when the appearance request never answers', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(api, 'fetchAppearance').mockReturnValue(new Promise(() => {}))
      const booting = bootV3()
      await vi.advanceTimersByTimeAsync(APPEARANCE_TIMEOUT_MS - 1)
      expect(document.documentElement.dataset.layout).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      await act(async () => {
        await booting
      })
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(document.documentElement.dataset.layout).toBe('v3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not register the service worker', async () => {
    const register = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true })
    try {
      vi.spyOn(api, 'fetchAppearance').mockResolvedValue({ theme_mode: 'light' })
      await act(async () => {
        await bootV3()
      })
      expect(register).not.toHaveBeenCalled()
    } finally {
      delete navigator.serviceWorker
    }
  })
})
