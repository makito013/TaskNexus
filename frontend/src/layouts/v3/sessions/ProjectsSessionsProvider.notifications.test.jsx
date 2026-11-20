import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { api } from '../../../services/api.js'
import { chatApi } from '../../../services/chatApi.js'
import { NOTIFICATION_SETTINGS_CHANGED_EVENT } from '../../../hooks/useNotificationSettings.js'
import { PUSH_SUBSCRIPTION_CHANGED_EVENT } from '../../../services/pushSubscription.js'
import ProjectsSessionsProvider from './ProjectsSessionsProvider.jsx'
import { useProjectsSessions } from './useProjectsSessions.js'

const KEY = 'Pessoal/p::claude::k3x9q2'
const OTHER = 'Pessoal/p::claude::zz9988'

let latest
function Probe() {
  latest = useProjectsSessions()
  return null
}

let notifier
let rows
const row = (key, extra = {}) => ({ session_key: key, needs_attention: false, push_notified: false, display_name: null, ...extra })
const pendingRows = (extra = {}) => [row(KEY, { needs_attention: true, ...extra }), row(OTHER)]

const SETTINGS = { quiet_hours_enabled: false, quiet_hours_start: '22:00', quiet_hours_end: '07:00', server_utc_offset_minutes: 0 }
const WINDOW_NOON = { ...SETTINGS, quiet_hours_enabled: true, quiet_hours_start: '11:00', quiet_hours_end: '13:00' }

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

beforeEach(() => {
  vi.useFakeTimers()
  // 12:00 UTC: outside the 22:00-07:00 window
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))
  notifier = { unlock: vi.fn(), playSound: vi.fn(), notify: vi.fn(), permission: 'granted' }
  rows = [row(KEY), row(OTHER)]
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'listSessions').mockImplementation(() => Promise.resolve(rows))
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchNotificationSettings').mockResolvedValue({ ...SETTINGS })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ProjectsSessionsProvider notifications (CA49)', () => {
  it('plays one sound and one notification per transition, never per poll', async () => {
    mount()
    await flush()
    expect(notifier.playSound).not.toHaveBeenCalled()

    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
    expect(notifier.notify.mock.calls[0][0]).toMatchObject({ tag: KEY })

    await pollOnce()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('a chat already pending when the page opens does not notify (no baseline)', async () => {
    rows = pendingRows()
    mount()
    await flush()
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('a pending approval counts as needing the user', async () => {
    mount()
    await flush()
    rows = [row(KEY, { pending_permissions: 1 }), row(OTHER)]
    await pollOnce()
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('notifies again after the mark was cleared and came back', async () => {
    mount()
    await flush()
    rows = pendingRows()
    await pollOnce()
    rows = [row(KEY), row(OTHER)]
    await pollOnce()
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(2)
  })

  it('a failed poll keeps the baseline: the next good poll does not notify again', async () => {
    mount()
    await flush()
    rows = pendingRows()
    await pollOnce()
    chatApi.listSessions.mockRejectedValueOnce(new Error('down'))
    await pollOnce()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('stays silent inside the quiet-hours window and does not fire when it ends', async () => {
    api.fetchNotificationSettings.mockResolvedValue({ ...WINDOW_NOON })
    mount()
    await flush()
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 14, 0, 0)))
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
  })

  it('the settings-changed event updates the window without a new fetch', async () => {
    mount()
    await flush()
    act(() => {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_SETTINGS_CHANGED_EVENT, { detail: { ...WINDOW_NOON } }))
    })
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
    expect(api.fetchNotificationSettings).toHaveBeenCalledTimes(1)
  })

  it('push ledger: push_notified mutes the sound on a push-subscribed device and keeps the notification', async () => {
    mount()
    await flush()
    act(() => {
      window.dispatchEvent(new CustomEvent(PUSH_SUBSCRIPTION_CHANGED_EVENT, { detail: { active: true } }))
    })
    rows = pendingRows({ push_notified: true })
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('push ledger: a device WITHOUT a subscription still plays the sound', async () => {
    mount()
    await flush()
    rows = pendingRows({ push_notified: true })
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
  })

  it('the conversation in focus on a visible tab never notifies itself', async () => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('a hidden tab does not count as looking at the conversation', async () => {
    mount()
    await flush()
    act(() => latest.setFocusedKey(KEY))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('the poll keeps running on a hidden tab, so the sound and the notification still go out', async () => {
    mount()
    await flush()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    rows = pendingRows()
    await pollOnce()
    expect(notifier.playSound).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('clearAttention drops the local mark of that chat at once', async () => {
    mount()
    await flush()
    rows = pendingRows()
    await pollOnce()
    expect(latest.projectsLive.persisted[KEY].needs_attention).toBe(true)
    act(() => latest.clearAttention(KEY))
    expect(latest.projectsLive.persisted[KEY].needs_attention).toBe(false)
    expect(latest.projectsLive.persisted[OTHER].needs_attention).toBe(false)
  })
})
