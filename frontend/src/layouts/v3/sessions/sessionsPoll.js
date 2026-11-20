// Schedule of the sessions poll, with no React and no network: the caller gives `run` (one
// tick) and the poller decides WHEN. One timer chain (never setInterval), so a slow tick is
// never overlapped by the next one.
//   - the first tick runs at start();
//   - the next one is scheduled `intervalMs` after the previous one FINISHED;
//   - the poll keeps its cadence while the page is hidden (the sound and the browser notification of
//     a chat that needs the user depend on it, as in the V2); becoming visible ticks at once;
//   - `withHealth` is true on the first tick and again every `healthIntervalMs`.
export const POLL_INTERVAL_MS = 7000
export const HEALTH_INTERVAL_MS = 5 * 60 * 1000
export const CREATED_GRACE_MS = 15000

export function createSessionsPoll({
  run,
  intervalMs = POLL_INTERVAL_MS,
  healthIntervalMs = HEALTH_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  let timer = null
  let stopped = true
  let running = false
  let lastHealthAt = null
  let visibilityHandler = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clearTimer()
    if (stopped) return
    timer = setTimeout(tick, intervalMs)
  }

  async function tick() {
    timer = null
    if (stopped || running) return
    running = true
    const at = now()
    const withHealth = lastHealthAt === null || at - lastHealthAt >= healthIntervalMs
    if (withHealth) lastHealthAt = at
    try {
      await run({ withHealth })
    } catch {
      // `run` is expected to swallow its own failures; a throw must still not kill the chain.
    } finally {
      running = false
      schedule()
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      visibilityHandler = () => {
        if (!document.hidden && !running) {
          clearTimer()
          void tick()
        }
      }
      document.addEventListener('visibilitychange', visibilityHandler)
      void tick()
    },
    // An extra tick now (after creating a chat, or on a "refresh" request).
    trigger() {
      if (stopped || running) return
      clearTimer()
      void tick()
    },
    stop() {
      stopped = true
      clearTimer()
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    },
  }
}
