import { describe, it, expect, vi } from 'vitest'
import { runBoot } from './runBoot.js'

describe('runBoot', () => {
  it('boots v2 when no v3 loader is given', async () => {
    const bootV2 = vi.fn().mockResolvedValue('v2')
    const result = await runBoot({ loadV3: null, bootV2 })
    expect(bootV2).toHaveBeenCalledTimes(1)
    expect(result).toBe('v2')
  })

  it('boots v3 when the loader resolves', async () => {
    const bootV2 = vi.fn()
    const bootV3 = vi.fn().mockResolvedValue('v3')
    const loadV3 = vi.fn().mockResolvedValue({ bootV3 })
    const result = await runBoot({ loadV3, bootV2 })
    expect(bootV3).toHaveBeenCalledTimes(1)
    expect(bootV2).not.toHaveBeenCalled()
    expect(result).toBe('v3')
  })

  it('falls back to v2 when the v3 chunk fails to load', async () => {
    const bootV2 = vi.fn().mockResolvedValue('v2')
    const loadV3 = vi.fn().mockRejectedValue(new Error('chunk failed'))
    const result = await runBoot({ loadV3, bootV2, onV3Error: () => {} })
    expect(bootV2).toHaveBeenCalledTimes(1)
    expect(result).toBe('v2')
  })

  it('falls back to v2 when bootV3 rejects', async () => {
    const bootV2 = vi.fn().mockResolvedValue('v2')
    const bootV3 = vi.fn().mockRejectedValue(new Error('boom'))
    const loadV3 = vi.fn().mockResolvedValue({ bootV3 })
    const result = await runBoot({ loadV3, bootV2, onV3Error: () => {} })
    expect(bootV2).toHaveBeenCalledTimes(1)
    expect(result).toBe('v2')
  })

  it('reports the v3 error through onV3Error', async () => {
    const error = new Error('boom')
    const onV3Error = vi.fn()
    const loadV3 = vi.fn().mockRejectedValue(error)
    await runBoot({ loadV3, bootV2: vi.fn(), onV3Error })
    expect(onV3Error).toHaveBeenCalledWith(error)
  })
})
