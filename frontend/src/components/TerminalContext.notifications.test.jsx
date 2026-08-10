// frontend/src/components/TerminalContext.notifications.test.jsx
// Channel A of the end-of-chat notification: sound + Web Notification when
// the 7s poll sees a chat become pending.
//
// The `notifier` is INJECTED into TerminalProvider — no test here touches
// `Notification`, `Audio`, or `AudioContext` for real (jsdom doesn't
// implement Web Audio, and a test depending on real notification permission
// wouldn't run in any CI). Kept in a separate file from
// TerminalContext.test.jsx so it doesn't mix with the auto-remount
// regressions, which use real timers.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TerminalProvider, useTerminal } from './TerminalContext.jsx';

const POLL_INTERVAL_MS = 7000;

const DEFAULT_NOTIFICATION_SETTINGS = {
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  server_utc_offset_minutes: 0,
  quiet_hours_active: false,
};

let persistedPayload;
let notificationSettings;
let notifier;

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function renderProvider() {
  return renderHook(() => useTerminal(), {
    wrapper: ({ children }) => (
      <TerminalProvider notifier={notifier}>{children}</TerminalProvider>
    ),
  });
}

/** Lets the polling's 7s interval run once and the tick's promises resolve.
 * `advanceTimersByTimeAsync` is what yields to the microtask queue between
 * the tick's awaits — `advanceTimersByTime` (synchronous) wouldn't.
 * No `waitFor` in this file: with fake timers it just ends up waiting for a
 * clock that only advances when the test tells it to. */
async function runPollTick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // Outside the 22:00-07:00 window by default (12:00 UTC with offset 0).
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
  persistedPayload = { 'projA::claude': { needs_attention: false, display_name: null } };
  notificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  notifier = { unlock: vi.fn(), playSound: vi.fn(), notify: vi.fn(), permission: 'granted' };
  global.fetch = vi.fn((url) => {
    if (url.includes('/settings/notifications')) return jsonResponse(notificationSettings);
    if (url.includes('/sessions/persisted')) return jsonResponse(persistedPayload);
    return jsonResponse({}); // /sessions/active — no live PTY
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Mounts the provider and lets the initial tick (which establishes the
 * baseline of "who was already pending") and the settings GET finish. */
async function mountAndSettle() {
  const rendered = renderProvider();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(rendered.result.current.persistedSessions['projA::claude']).toBeDefined();
  return rendered;
}

describe('TerminalContext — channel A (sound + Web Notification)', () => {
  it('notifies once when a chat becomes pending, and does not repeat on later ticks', async () => {
    const { unmount } = await mountAndSettle();
    expect(notifier.playSound).not.toHaveBeenCalled();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith({
      tag: 'projA::claude',
      title: 'claude terminou',
      body: 'Projeto projA',
    });

    // The regression this test exists to catch: needs_attention stays true
    // on every tick until the ack, so notifying by STATE (instead of by
    // transition) would play the sound every 7 seconds.
    await runPollTick();
    await runPollTick();
    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not notify for chats that were already pending when the page opened', async () => {
    // Opening the app in the morning with pendencies from overnight isn't a
    // transition at all — none of it was observed by this tab.
    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null },
      'projB::claude': { needs_attention: true, display_name: null },
    };
    const { unmount } = await mountAndSettle();
    await runPollTick();

    expect(notifier.playSound).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();

    unmount();
  });

  it('plays one sound but one notification per chat when several finish in the same tick', async () => {
    const { unmount } = await mountAndSettle();

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null },
      'projB::gemini': { needs_attention: true, display_name: 'Refactor' },
    };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(2);
    expect(notifier.notify).toHaveBeenCalledWith({
      tag: 'projB::gemini',
      title: 'Refactor terminou',
      body: 'Projeto projB · gemini',
    });

    unmount();
  });

  it('stays silent during quiet hours but still exposes the pending state to the badge', async () => {
    notificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      quiet_hours_enabled: true,
      quiet_hours_active: true,
    };
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 23, 30, 0))); // 23:30, inside 22:00-07:00
    const { result, unmount } = await mountAndSettle();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();

    expect(notifier.playSound).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
    // The quiet-hours window mutes sound/notification, never the badge or
    // title — that's what remains when the browser permission is denied.
    expect(result.current.persistedSessions['projA::claude'].needs_attention).toBe(true);
    expect(document.title).toBe('(1) TaskNexus');

    unmount();
  });

  it('notifies again outside the quiet window for a chat that finishes later', async () => {
    notificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, quiet_hours_enabled: true };
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 23, 30, 0)));
    const { unmount } = await mountAndSettle();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();
    expect(notifier.notify).not.toHaveBeenCalled();

    // 09:00 the next day: outside the window, and a NEW chat finishes.
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2, 9, 0, 0)));
    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null },
      'projB::claude': { needs_attention: true, display_name: null },
    };
    await runPollTick();

    // Only the new one — what was silenced overnight is discarded, not deferred.
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'projB::claude' }),
    );

    unmount();
  });

  it('never notifies the focused chat (the poll acks it in the same tick)', async () => {
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');
    const { unmount } = await mountAndSettle();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();

    expect(notifier.playSound).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();

    unmount();
  });

  it('re-notifies a chat that finishes again after being acked', async () => {
    const { unmount } = await mountAndSettle();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();
    expect(notifier.notify).toHaveBeenCalledTimes(1);

    persistedPayload = { 'projA::claude': { needs_attention: false, display_name: null } };
    await runPollTick();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();
    expect(notifier.notify).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('does not reset its baseline when the persisted fetch fails (no notification storm)', async () => {
    const { unmount } = await mountAndSettle();

    persistedPayload = { 'projA::claude': { needs_attention: true, display_name: null } };
    await runPollTick();
    expect(notifier.notify).toHaveBeenCalledTimes(1);

    // Network drop only on /sessions/persisted: the tick can't conclude
    // "nothing is pending" and free everything to notify again later.
    global.fetch = vi.fn((url) => {
      if (url.includes('/settings/notifications')) return jsonResponse(notificationSettings);
      if (url.includes('/sessions/persisted')) return Promise.reject(new Error('offline'));
      return jsonResponse({});
    });
    await runPollTick();

    global.fetch = vi.fn((url) => {
      if (url.includes('/settings/notifications')) return jsonResponse(notificationSettings);
      if (url.includes('/sessions/persisted')) return jsonResponse(persistedPayload);
      return jsonResponse({});
    });
    await runPollTick();

    expect(notifier.notify).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('unlocks audio/permission on the first user gesture, not on page load', async () => {
    const { unmount } = await mountAndSettle();
    expect(notifier.unlock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerdown'));
    expect(notifier.unlock).toHaveBeenCalledTimes(1);

    // `once: true` — a second gesture doesn't repeat the request.
    window.dispatchEvent(new Event('pointerdown'));
    expect(notifier.unlock).toHaveBeenCalledTimes(1);

    unmount();
  });
});
