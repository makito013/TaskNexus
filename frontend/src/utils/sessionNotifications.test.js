// frontend/src/utils/sessionNotifications.test.js
import { describe, it, expect } from 'vitest';
import { decideSessionsToNotify, buildSessionNotification } from './sessionNotifications.js';

const pendingSession = { needs_attention: true, display_name: null };
const quietSession = { needs_attention: false, display_name: null };

describe('decideSessionsToNotify — baseline', () => {
  it('does not notify on the very first observation (notifiedKeys === null)', () => {
    // Opening the page in the morning with 3 chats pending from overnight
    // can't fire 3 sounds: none of them is a transition observed by this tab.
    const { toNotify, nextNotifiedKeys } = decideSessionsToNotify({
      sessions: { a: pendingSession, b: pendingSession, c: quietSession },
      notifiedKeys: null,
    });
    expect(toNotify).toEqual([]);
    expect(nextNotifiedKeys.sort()).toEqual(['a', 'b']);
  });
});

describe('decideSessionsToNotify — transition detection', () => {
  it('notifies a session that just became pending', () => {
    const { toNotify } = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: [],
    });
    expect(toNotify).toEqual(['a']);
  });

  it('never notifies the same pending session twice (no sound every 7s)', () => {
    const first = decideSessionsToNotify({ sessions: { a: pendingSession }, notifiedKeys: [] });
    expect(first.toNotify).toEqual(['a']);

    const second = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: first.nextNotifiedKeys,
    });
    expect(second.toNotify).toEqual([]);
    expect(second.nextNotifiedKeys).toEqual(['a']);
  });

  it('re-notifies after the session was acked and becomes pending again', () => {
    const first = decideSessionsToNotify({ sessions: { a: pendingSession }, notifiedKeys: [] });
    const acked = decideSessionsToNotify({
      sessions: { a: quietSession },
      notifiedKeys: first.nextNotifiedKeys,
    });
    expect(acked.nextNotifiedKeys).toEqual([]);

    const again = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: acked.nextNotifiedKeys,
    });
    expect(again.toNotify).toEqual(['a']);
  });

  it('forgets sessions that disappeared from the map (terminated chats)', () => {
    const first = decideSessionsToNotify({ sessions: { a: pendingSession }, notifiedKeys: [] });
    const gone = decideSessionsToNotify({ sessions: {}, notifiedKeys: first.nextNotifiedKeys });
    expect(gone.toNotify).toEqual([]);
    expect(gone.nextNotifiedKeys).toEqual([]);
  });

  it('notifies only the newly pending session when another was already notified', () => {
    const { toNotify } = decideSessionsToNotify({
      sessions: { a: pendingSession, b: pendingSession },
      notifiedKeys: ['a'],
    });
    expect(toNotify).toEqual(['b']);
  });
});

describe('decideSessionsToNotify — focus and quiet hours', () => {
  it('never notifies the focused session (it is acked by the poll anyway)', () => {
    const { toNotify, nextNotifiedKeys } = decideSessionsToNotify({
      sessions: { a: pendingSession, b: pendingSession },
      notifiedKeys: [],
      focusedKey: 'a',
    });
    expect(toNotify).toEqual(['b']);
    expect(nextNotifiedKeys).toEqual(['b']);
  });

  it('delivers nothing while quiet hours are active', () => {
    const { toNotify } = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: [],
      quietHoursActive: true,
    });
    expect(toNotify).toEqual([]);
  });

  it('does NOT replay suppressed notifications once quiet hours end', () => {
    // The window discards, it doesn't defer — otherwise at 07:00 there'd be
    // a volley of sounds for what finished overnight.
    const during = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: [],
      quietHoursActive: true,
    });
    const after = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: during.nextNotifiedKeys,
      quietHoursActive: false,
    });
    expect(after.toNotify).toEqual([]);
  });

  it('still notifies a chat that becomes pending AFTER quiet hours end', () => {
    const during = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: [],
      quietHoursActive: true,
    });
    const after = decideSessionsToNotify({
      sessions: { a: pendingSession, b: pendingSession },
      notifiedKeys: during.nextNotifiedKeys,
      quietHoursActive: false,
    });
    expect(after.toNotify).toEqual(['b']);
  });

  it('tolerates a missing/empty session map', () => {
    expect(decideSessionsToNotify({ sessions: undefined, notifiedKeys: [] })).toEqual({
      toNotify: [],
      toSound: [],
      nextNotifiedKeys: [],
    });
  });
});

describe('decideSessionsToNotify — anti-double-sound ledger (Phase 3, push)', () => {
  const pushedSession = { needs_attention: true, push_notified: true };

  it('plays the sound when this device has no push subscription', () => {
    // THE critical case. `push_notified` says the server pushed to SOME
    // device; a browser that isn't one of them heard nothing, so muting it
    // here would mean enabling push on the phone silently mutes the desktop.
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession },
      notifiedKeys: [],
      hasPushSubscription: false,
    });
    expect(toNotify).toEqual(['a']);
    expect(toSound).toEqual(['a']);
  });

  it('suppresses the sound on a device that is subscribed to push', () => {
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession },
      notifiedKeys: [],
      hasPushSubscription: true,
    });
    // The visual notification still fires — it shares the tag with the push
    // and silently replaces it rather than stacking.
    expect(toNotify).toEqual(['a']);
    expect(toSound).toEqual([]);
  });

  it('still plays the sound for a pause the server did NOT push', () => {
    const { toSound } = decideSessionsToNotify({
      sessions: { a: pendingSession },
      notifiedKeys: [],
      hasPushSubscription: true,
    });
    expect(toSound).toEqual(['a']);
  });

  it('suppresses only the pushed chats when several finish in the same tick', () => {
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession, b: pendingSession },
      notifiedKeys: [],
      hasPushSubscription: true,
    });
    expect(toNotify.sort()).toEqual(['a', 'b']);
    expect(toSound).toEqual(['b']);
  });

  it('delivers neither sound nor notification during quiet hours, pushed or not', () => {
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession },
      notifiedKeys: [],
      quietHoursActive: true,
      hasPushSubscription: true,
    });
    expect(toNotify).toEqual([]);
    expect(toSound).toEqual([]);
  });

  it('delivers nothing on the first observation, pushed or not', () => {
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession },
      notifiedKeys: null,
      hasPushSubscription: true,
    });
    expect(toNotify).toEqual([]);
    expect(toSound).toEqual([]);
  });

  it('treats a missing push_notified field as not pushed', () => {
    // Sessions persisted before this column existed, and any older backend.
    const { toSound } = decideSessionsToNotify({
      sessions: { a: { needs_attention: true } },
      notifiedKeys: [],
      hasPushSubscription: true,
    });
    expect(toSound).toEqual(['a']);
  });

  it('never notifies or sounds for the focused session even when pushed', () => {
    const { toNotify, toSound } = decideSessionsToNotify({
      sessions: { a: pushedSession },
      notifiedKeys: [],
      focusedKey: 'a',
      hasPushSubscription: true,
    });
    expect(toNotify).toEqual([]);
    expect(toSound).toEqual([]);
  });
});

describe('buildSessionNotification', () => {
  it('uses tag = session_key so one session never stacks two notifications', () => {
    expect(buildSessionNotification('meu-projeto::claude').tag).toBe('meu-projeto::claude');
  });

  it('identifies agent and project when there is no custom name', () => {
    const { title, body } = buildSessionNotification('meu-projeto::claude', { display_name: null });
    expect(title).toBe('claude terminou');
    expect(body).toBe('Projeto meu-projeto');
  });

  it('prefers the custom name and still says which agent/project finished', () => {
    const { title, body } = buildSessionNotification('meu-projeto::claude-work', {
      display_name: 'Bugfix urgente',
    });
    expect(title).toBe('Bugfix urgente terminou');
    expect(body).toBe('Projeto meu-projeto · claude-work');
  });

  it('ignores the random suffix of a second chat of the same agent', () => {
    const { title, body } = buildSessionNotification('meu-projeto::claude::x7f2ab');
    expect(title).toBe('claude terminou');
    expect(body).toBe('Projeto meu-projeto');
  });

  it('keeps sub-project paths intact in the body', () => {
    expect(buildSessionNotification('cliente/site::claude').body).toBe('Projeto cliente/site');
  });
});
