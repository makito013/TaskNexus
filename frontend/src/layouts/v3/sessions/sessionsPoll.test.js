import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CREATED_GRACE_MS, HEALTH_INTERVAL_MS, POLL_INTERVAL_MS, createSessionsPoll } from './sessionsPoll.js'

let hidden
beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setHidden(value) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('sessionsPoll', () => {
  it('has the cadence of the decision table', () => {
    expect(POLL_INTERVAL_MS).toBe(7000)
    expect(HEALTH_INTERVAL_MS).toBe(300000)
    expect(CREATED_GRACE_MS).toBe(15000)
  })

  it('ticks at start and then 7 s after each tick finished', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    poll.stop()
  })

  it('never overlaps a slow tick', async () => {
    let finish
    const run = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(30000)
    expect(run).toHaveBeenCalledTimes(1)
    poll.trigger()
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(7000)
    expect(run).toHaveBeenCalledTimes(2)
    poll.stop()
  })

  it('asks for health on the first tick and then every 5 minutes', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS + 7000)
    const flags = run.mock.calls.map(([arg]) => arg.withHealth)
    expect(flags[0]).toBe(true)
    expect(flags.slice(1, -1).every((flag) => flag === false)).toBe(true)
    expect(flags.at(-1)).toBe(true)
    poll.stop()
  })

  it('keeps polling every 7 s while hidden and ticks at once when visible again', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(0)
    setHidden(true)
    // Hiding the tab starts no tick of its own (only becoming visible does).
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(document.hidden).toBe(true)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(9)
    const before = run.mock.calls.length
    setHidden(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(before + 1)
    poll.stop()
  })

  it('survives a run that throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(14000)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    poll.stop()
  })

  it('leaves no timer and no listener after stop', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const poll = createSessionsPoll({ run })
    poll.start()
    await vi.advanceTimersByTimeAsync(0)
    poll.stop()
    expect(vi.getTimerCount()).toBe(0)
    setHidden(false)
    poll.trigger()
    await vi.advanceTimersByTimeAsync(60000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
