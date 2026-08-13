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
import { TerminalProvider, useTerminal, readSessionKeyFromLocation } from './TerminalContext.jsx';
import { PUSH_SUBSCRIPTION_CHANGED_EVENT } from '../services/pushSubscription.js';

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

// ─── Phase 3: anti-double-sound ledger and the push deep link ──────────────

describe('readSessionKeyFromLocation', () => {
  it('reads the session key the service worker deep-linked to', () => {
    expect(readSessionKeyFromLocation('?session=projA::claude')).toBe('projA::claude');
  });

  it('decodes the percent-encoding the service worker applied', () => {
    // R-7: the key always carries '::' and the projectId can carry '/'.
    expect(readSessionKeyFromLocation('?session=cliente%2Fsite%3A%3Aclaude'))
      .toBe('cliente/site::claude');
  });

  it('returns null when there is no session parameter', () => {
    expect(readSessionKeyFromLocation('')).toBeNull();
    expect(readSessionKeyFromLocation('?other=1')).toBeNull();
  });

  it('returns null for a blank value', () => {
    expect(readSessionKeyFromLocation('?session=')).toBeNull();
    expect(readSessionKeyFromLocation('?session=%20')).toBeNull();
  });
});

describe('TerminalContext — push deep link', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('opens the chat named in the ?session= deep link', async () => {
    window.history.replaceState({}, '', '/?session=projA%3A%3Aclaude');
    const { result, unmount } = await mountAndSettle();
    expect(result.current.activeSessionKey).toBe('projA::claude');
    unmount();
  });

  it('selects the deep-linked chat PROJECT too, in the same initializer', async () => {
    // R-6: selectedProjectId is independent state. Without deriving it here,
    // the app would open the notified chat while the tab strip still
    // rendered the previously selected project — the tab wouldn't even be
    // visible.
    localStorage.setItem('escritorio::selected_project_id', 'outro-projeto');
    window.history.replaceState({}, '', '/?session=projA%3A%3Aclaude');
    const { result, unmount } = await mountAndSettle();
    expect(result.current.selectedProjectId).toBe('projA');
    unmount();
  });

  it('wins over the session restored from localStorage', async () => {
    // The user just tapped a specific notification — a stronger statement of
    // intent than whatever tab happened to be open last.
    localStorage.setItem('escritorio::active_session_key', 'projB::gemini');
    window.history.replaceState({}, '', '/?session=projA%3A%3Aclaude');
    const { result, unmount } = await mountAndSettle();
    expect(result.current.activeSessionKey).toBe('projA::claude');
    unmount();
  });

  it('keeps a sub-project path intact when deriving the project', async () => {
    window.history.replaceState({}, '', '/?session=cliente%2Fsite%3A%3Aclaude');
    const { result, unmount } = await mountAndSettle();
    expect(result.current.activeSessionKey).toBe('cliente/site::claude');
    expect(result.current.selectedProjectId).toBe('cliente/site');
    unmount();
  });

  it('falls back to localStorage when there is no deep link', async () => {
    localStorage.setItem('escritorio::active_session_key', 'projB::gemini');
    const { result, unmount } = await mountAndSettle();
    expect(result.current.activeSessionKey).toBe('projB::gemini');
    unmount();
  });
});

describe('TerminalContext — anti-double-sound ledger', () => {
  /** Flips the provider's per-device push flag through the same event the
   * Settings screen emits. */
  function setDeviceSubscribed(active) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PUSH_SUBSCRIPTION_CHANGED_EVENT, { detail: { active } }),
      );
    });
  }

  it('still plays the sound when this device has no push subscription', async () => {
    // THE critical case: push_notified says the server pushed to SOME
    // device. A browser that isn't one of them heard nothing, so muting it
    // would mean enabling push on the phone silently mutes the desktop.
    const { unmount } = await mountAndSettle();

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null, push_notified: true },
    };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('suppresses the sound on a device that receives the push', async () => {
    const { unmount } = await mountAndSettle();
    setDeviceSubscribed(true);

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null, push_notified: true },
    };
    await runPollTick();

    expect(notifier.playSound).not.toHaveBeenCalled();
    // The visual notification still fires: it shares tag = session_key with
    // the push, so it replaces it silently instead of stacking.
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps playing the sound for a pause the server did NOT push', async () => {
    const { unmount } = await mountAndSettle();
    setDeviceSubscribed(true);

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null, push_notified: false },
    };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('plays the sound again once push is disabled on this device', async () => {
    const { unmount } = await mountAndSettle();
    setDeviceSubscribed(true);
    setDeviceSubscribed(false);

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null, push_notified: true },
    };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('plays one sound when a pushed and a non-pushed chat finish together', async () => {
    const { unmount } = await mountAndSettle();
    setDeviceSubscribed(true);

    persistedPayload = {
      'projA::claude': { needs_attention: true, display_name: null, push_notified: true },
      'projB::gemini': { needs_attention: true, display_name: null, push_notified: false },
    };
    await runPollTick();

    expect(notifier.playSound).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(2);
    unmount();
  });
});
