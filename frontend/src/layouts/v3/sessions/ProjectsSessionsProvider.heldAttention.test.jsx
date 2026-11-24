import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { api } from '../../../services/api.js'
import { chatApi } from '../../../services/chatApi.js'
import { PUSH_SUBSCRIPTION_CHANGED_EVENT } from '../../../services/pushSubscription.js'
import ProjectsSessionsProvider from './ProjectsSessionsProvider.jsx'
import { useProjectsSessions } from './useProjectsSessions.js'

// The device may already hold a push subscription when the page opens (the production path): the
// reconciliation of the mount answers `true` without any event.
const pushState = vi.hoisted(() => ({ active: false }))
vi.mock('../../../services/pushSubscription.js', async (importActual) => ({
  ...(await importActual()),
  reconcilePushSubscription: vi.fn(() => Promise.resolve(pushState.active)),
}))

// Every poll hands out NEW objects, as the real fetch does (a harness that returns the same reference
// never re-runs the notification effect, which is what hid the original defect).
const KEY = 'Pessoal/p::claude::k3x9q2'
const OTHER = 'Pessoal/p::claude::zz9988'
const CODEX = 'Pessoal/p::codex'

let latest
function Probe() {
  latest = useProjectsSessions()
  return null
}

let notifier
let rows
let terminalRows
let hidden
const row = (key, extra = {}) => ({ session_key: key, needs_attention: false, push_notified: false, display_name: null, ...extra })
const copyRows = () => rows.map((entry) => ({ ...entry }))
const copyTerminal = () => Object.fromEntries(Object.entries(terminalRows).map(([key, value]) => [key, { ...value }]))

function mount() {
  render(
    <ProjectsSessionsProvider navigate={vi.fn()} notifier={notifier}>
      <Probe />
    </ProjectsSessionsProvider>,
  )
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const pollOnce = () => act(async () => {
  await vi.advanceTimersByTimeAsync(7000)
  await vi.advanceTimersByTimeAsync(0)
})
const setHidden = async (value) => {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
  await flush()
}
const sounds = () => notifier.playSound.mock.calls.length
const notifies = () => notifier.notify.mock.calls.length

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))
  hidden = false
  pushState.active = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'))
  notifier = { unlock: vi.fn(), playSound: vi.fn(), notify: vi.fn(), permission: 'granted' }
  rows = [row(KEY), row(OTHER)]
  terminalRows = {}
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'listSessions').mockImplementation(() => Promise.resolve(copyRows()))
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
  vi.spyOn(api, 'fetchNotificationSettings').mockResolvedValue({ quiet_hours_enabled: false })
  vi.spyOn(api, 'fetchPersistedSessions').mockImplementation(() => Promise.resolve(copyTerminal()))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A mark the focused conversation cannot clear: an approval pending, or a terminal view.
const UNCLEARABLE = [
  ['an approval pending', { pending_permissions: 1 }],
  ['a mark on the terminal view', { needs_attention: true }],
]

describe('a mark the user already had in front of them never notifies again', () => {
  it.each(UNCLEARABLE)('%s: hiding the tab three times plays no sound and shows no notification', async (_label, extra) => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    rows = [row(KEY, extra), row(OTHER)]
    await pollOnce() // the transition happens while the user looks at it
    expect(sounds()).toBe(0)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await setHidden(true)
      await pollOnce()
      await setHidden(false)
      await pollOnce()
    }
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(0)
  })

  it.each(UNCLEARABLE)('%s: leaving the conversation plays no sound', async (_label, extra) => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    rows = [row(KEY, extra), row(OTHER)]
    await pollOnce()
    await pollOnce()
    act(() => latest.setFocusedKey(null))
    await pollOnce()
    await pollOnce()
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(0)
  })

  it('the mark going away and coming back after leaving notifies once (a new transition)', async () => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    rows = [row(KEY, { needs_attention: true }), row(OTHER)]
    await pollOnce()
    act(() => latest.setFocusedKey(null))
    await pollOnce()
    rows = [row(KEY), row(OTHER)]
    await pollOnce()
    rows = [row(KEY, { needs_attention: true }), row(OTHER)]
    await pollOnce()
    expect(sounds()).toBe(1)
    expect(notifies()).toBe(1)
  })

  it('a turn that ends while the conversation is open but the tab is hidden still notifies, once', async () => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    await setHidden(true)
    rows = [row(KEY, { needs_attention: true }), row(OTHER)]
    await pollOnce()
    await pollOnce()
    expect(sounds()).toBe(1)
    expect(notifies()).toBe(1)
  })
})

describe('sessions with no chat row (codex, agy, the plain terminal) notify as in the V2', () => {
  it('plays one sound and one notification per transition, never per poll', async () => {
    mount()
    await flush()
    terminalRows = { [CODEX]: { display_name: null, needs_attention: true, push_notified: false } }
    await pollOnce()
    await pollOnce()
    await pollOnce()
    expect(sounds()).toBe(1)
    expect(notifies()).toBe(1)
    expect(notifier.notify.mock.calls[0][0]).toMatchObject({ tag: CODEX, title: 'codex terminou' })
  })

  it('a session already pending when the page opens does not notify (baseline)', async () => {
    terminalRows = { [CODEX]: { needs_attention: true } }
    mount()
    await flush()
    await pollOnce()
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(0)
  })

  it('waits for the first answer of the terminal list before it records a baseline', async () => {
    api.fetchPersistedSessions.mockRejectedValue(new Error('down'))
    mount()
    await flush()
    rows = [row(KEY, { needs_attention: true }), row(OTHER)]
    await pollOnce()
    expect(sounds()).toBe(0) // nothing is recorded yet
    api.fetchPersistedSessions.mockImplementation(() => Promise.resolve({ [CODEX]: { needs_attention: true } }))
    await pollOnce() // first answer: baseline, no volley for what was pending all along
    await pollOnce()
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(0)
  })

  it('a failed tick of the terminal list keeps the last rows and notifies nothing again', async () => {
    mount()
    await flush()
    terminalRows = { [CODEX]: { needs_attention: true } }
    await pollOnce()
    expect(sounds()).toBe(1)
    api.fetchPersistedSessions.mockRejectedValueOnce(new Error('blip'))
    await pollOnce()
    await pollOnce()
    expect(sounds()).toBe(1)
  })

  it('the one open on the terminal view, hidden three times, stays silent', async () => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(CODEX))
    terminalRows = { [CODEX]: { needs_attention: true } }
    await pollOnce()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await setHidden(true)
      await pollOnce()
      await setHidden(false)
      await pollOnce()
    }
    act(() => latest.setFocusedKey(null))
    await pollOnce()
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(0)
  })

  it('a key on both lists is pending when either says so, and notifies once', async () => {
    mount()
    await flush()
    terminalRows = { [KEY]: { needs_attention: true } }
    await pollOnce()
    await pollOnce()
    expect(notifies()).toBe(1)
    expect(notifier.notify.mock.calls[0][0]).toMatchObject({ tag: KEY })
  })

  it('clearAttention drops the local mark of a terminal session', async () => {
    mount()
    await flush()
    terminalRows = { [CODEX]: { needs_attention: true } }
    await pollOnce()
    expect(latest.ptyPersisted[CODEX].needs_attention).toBe(true)
    act(() => latest.clearAttention(CODEX))
    expect(latest.ptyPersisted[CODEX].needs_attention).toBe(false)
  })
})

describe('what the older tests left alive', () => {
  it('unlocks the audio on the first gesture of the page', async () => {
    mount()
    await flush()
    expect(notifier.unlock).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pointerdown'))
    expect(notifier.unlock).toHaveBeenCalledTimes(1)
  })

  it('two chats that turn pending in the same tick: one sound, one notification each', async () => {
    mount()
    await flush()
    rows = [row(KEY, { needs_attention: true }), row(OTHER, { needs_attention: true })]
    await pollOnce()
    expect(sounds()).toBe(1)
    expect(notifies()).toBe(2)
    expect(notifier.notify.mock.calls.map(([content]) => content.tag).sort()).toEqual([KEY, OTHER].sort())
  })

  it('clearAttention clears only that chat: another one that needs the user keeps its mark', async () => {
    mount()
    await flush()
    rows = [row(KEY, { needs_attention: true }), row(OTHER, { needs_attention: true })]
    await pollOnce()
    act(() => latest.clearAttention(KEY))
    expect(latest.projectsLive.persisted[KEY].needs_attention).toBe(false)
    expect(latest.projectsLive.persisted[OTHER].needs_attention).toBe(true)
  })

  it('push ledger with a subscription already active when the page opens: push_notified mutes the sound', async () => {
    pushState.active = true
    mount()
    await flush() // no PUSH_SUBSCRIPTION_CHANGED_EVENT: only the reconciliation of the mount says so
    rows = [row(KEY, { needs_attention: true, push_notified: true }), row(OTHER)]
    await pollOnce()
    expect(sounds()).toBe(0)
    expect(notifies()).toBe(1)
  })

  it('push ledger: a device whose subscription is switched off plays the sound again', async () => {
    pushState.active = true
    mount()
    await flush()
    act(() => {
      window.dispatchEvent(new CustomEvent(PUSH_SUBSCRIPTION_CHANGED_EVENT, { detail: { active: false } }))
    })
    rows = [row(KEY, { needs_attention: true, push_notified: true }), row(OTHER)]
    await pollOnce()
    expect(sounds()).toBe(1)
  })
})
