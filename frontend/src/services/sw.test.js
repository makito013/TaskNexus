// frontend/src/services/sw.test.js
// Test harness for the service worker (frontend/public/sw.js).
//
// The file under test lives in public/ and is copied VERBATIM by Vite, so it
// is the exact artifact that ships — which is why this reads it from disk and
// evaluates it, instead of importing a copy that could drift. It cannot be
// imported normally either: it is a classic script that expects a
// ServiceWorkerGlobalScope (`self`), which jsdom does not provide.
//
// The test file lives in src/ and not next to sw.js on purpose: everything
// under public/ ends up inside dist/, and a test file has no business being
// deployed.
//
// Phase 3 (Web Push) is the first coverage this file has ever had.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Resolved from the Vitest root (frontend/), not from import.meta.url: under
// the jsdom environment import.meta.url is an http:// URL, which
// fileURLToPath refuses.
const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf-8');

/** Minimal ServiceWorkerGlobalScope stub: captures every registered listener
 * so the tests can invoke them directly. */
function createServiceWorkerScope({ windowClients = [] } = {}) {
  const listeners = {};
  const scope = {
    listeners,
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn().mockResolvedValue(undefined),
      pushManager: { subscribe: vi.fn() },
    },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue(windowClients),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
    fetch: vi.fn(),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: { userAgent: 'TestBrowser/1.0' },
    Uint8Array,
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'fetch', 'Uint8Array', SW_SOURCE)(scope, scope.fetch, Uint8Array);
  return scope;
}

/** Push event stub. `data` follows the PushMessageData interface (a .json()
 * method), not a plain object. */
function pushEvent(payload, { invalidJson = false } = {}) {
  const waited = [];
  return {
    waited,
    data: payload === undefined ? null : {
      json: () => {
        if (invalidJson) throw new SyntaxError('not json');
        return payload;
      },
    },
    waitUntil: (promise) => { waited.push(promise); },
  };
}

function notificationClickEvent(data) {
  const waited = [];
  return {
    waited,
    notification: { close: vi.fn(), data },
    waitUntil: (promise) => { waited.push(promise); },
  };
}

describe('sw.js — lifecycle listeners (Phase 2, must not regress)', () => {
  it('registers install, activate and fetch listeners', () => {
    const scope = createServiceWorkerScope();
    expect(typeof scope.listeners.install).toBe('function');
    expect(typeof scope.listeners.activate).toBe('function');
    expect(typeof scope.listeners.fetch).toBe('function');
  });

  it('does not call respondWith on fetch, so requests fall through to the network', () => {
    const scope = createServiceWorkerScope();
    const respondWith = vi.fn();
    scope.listeners.fetch({ respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});

describe('sw.js — push listener', () => {
  let scope;
  beforeEach(() => { scope = createServiceWorkerScope(); });

  it('registers a push listener', () => {
    expect(typeof scope.listeners.push).toBe('function');
  });

  it('shows the notification with the payload title and body', async () => {
    const event = pushEvent({
      title: 'claude terminou', body: 'Projeto meu-projeto',
      tag: 'meu-projeto::claude', data: { session_key: 'meu-projeto::claude' },
    });
    scope.listeners.push(event);
    await Promise.all(event.waited);

    expect(scope.registration.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = scope.registration.showNotification.mock.calls[0];
    expect(title).toBe('claude terminou');
    expect(options.body).toBe('Projeto meu-projeto');
  });

  it('uses tag = session_key and never sets renotify', async () => {
    // tag = session_key is how "one notification per session" is
    // implemented: a new push for the same chat replaces the previous one.
    // `renotify` would make that replacement audible again — exactly the
    // double alert the whole ledger exists to avoid.
    const event = pushEvent({ title: 't', body: 'b', tag: 'meu-projeto::claude' });
    scope.listeners.push(event);
    await Promise.all(event.waited);

    const [, options] = scope.registration.showNotification.mock.calls[0];
    expect(options.tag).toBe('meu-projeto::claude');
    expect(options.renotify).toBeUndefined();
  });

  it('passes the payload data through so notificationclick can deep-link', async () => {
    const event = pushEvent({ title: 't', body: 'b', tag: 'k', data: { session_key: 'p::a' } });
    scope.listeners.push(event);
    await Promise.all(event.waited);

    const [, options] = scope.registration.showNotification.mock.calls[0];
    expect(options.data).toEqual({ session_key: 'p::a' });
  });

  it('calls waitUntil so the worker is not killed before the notification shows', () => {
    const event = pushEvent({ title: 't', body: 'b', tag: 'k' });
    scope.listeners.push(event);
    expect(event.waited).toHaveLength(1);
  });

  it('still notifies when the payload is missing entirely', async () => {
    const event = pushEvent(undefined);
    scope.listeners.push(event);
    await Promise.all(event.waited);
    expect(scope.registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it('still notifies when the payload is not valid JSON', async () => {
    const event = pushEvent(null, { invalidJson: true });
    scope.listeners.push(event);
    await Promise.all(event.waited);
    expect(scope.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe('sw.js — notificationclick listener', () => {
  it('opens a window deep-linked to the session when nothing is open', async () => {
    const scope = createServiceWorkerScope({ windowClients: [] });
    const event = notificationClickEvent({ session_key: 'meu-projeto::claude' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(scope.clients.openWindow).toHaveBeenCalledWith(
      '/?session=meu-projeto%3A%3Aclaude',
    );
  });

  it('percent-encodes a session key containing a sub-project path', () => {
    // R-7: the key carries '::' AND the projectId can carry '/'. Passing it
    // raw would break the query string.
    expect(encodeURIComponent('cliente/site::claude')).toBe('cliente%2Fsite%3A%3Aclaude');
  });

  it('percent-encodes both the separator and the slash in the opened URL', async () => {
    const scope = createServiceWorkerScope({ windowClients: [] });
    const event = notificationClickEvent({ session_key: 'cliente/site::claude' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(scope.clients.openWindow).toHaveBeenCalledWith(
      '/?session=cliente%2Fsite%3A%3Aclaude',
    );
  });

  it('focuses an already-open window instead of opening a second one', async () => {
    const client = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
    };
    const scope = createServiceWorkerScope({ windowClients: [client] });
    const event = notificationClickEvent({ session_key: 'p::a' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(client.focus).toHaveBeenCalled();
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it('navigates the focused window to the clicked session', async () => {
    const client = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
    };
    const scope = createServiceWorkerScope({ windowClients: [client] });
    const event = notificationClickEvent({ session_key: 'p::a' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(client.navigate).toHaveBeenCalledWith('/?session=p%3A%3Aa');
  });

  it('still focuses the window when navigate() rejects', async () => {
    const client = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockRejectedValue(new Error('not allowed')),
    };
    const scope = createServiceWorkerScope({ windowClients: [client] });
    const event = notificationClickEvent({ session_key: 'p::a' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(client.focus).toHaveBeenCalled();
  });

  it('includes uncontrolled windows in the search', async () => {
    // A tab loaded before this worker took control is not "controlled" by
    // it — without includeUncontrolled it would be invisible, and every
    // click would open a duplicate app window.
    const scope = createServiceWorkerScope({ windowClients: [] });
    const event = notificationClickEvent({ session_key: 'p::a' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(scope.clients.matchAll).toHaveBeenCalledWith(
      expect.objectContaining({ includeUncontrolled: true, type: 'window' }),
    );
  });

  it('opens the app root when the notification carries no session key', async () => {
    const scope = createServiceWorkerScope({ windowClients: [] });
    const event = notificationClickEvent({});
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(scope.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('closes the notification when clicked', async () => {
    const scope = createServiceWorkerScope({ windowClients: [] });
    const event = notificationClickEvent({ session_key: 'p::a' });
    scope.listeners.notificationclick(event);
    await Promise.all(event.waited);

    expect(event.notification.close).toHaveBeenCalled();
  });
});

describe('sw.js — pushsubscriptionchange listener', () => {
  const VAPID_PUBLIC_KEY = 'BPublicKey_with-urlsafe-chars';

  function stubFetch(scope, subscriptionJson) {
    scope.registration.pushManager.subscribe.mockResolvedValue({
      toJSON: () => subscriptionJson,
    });
    scope.fetch.mockImplementation((url) => {
      if (String(url).endsWith('/vapid-public-key')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ public_key: VAPID_PUBLIC_KEY, available: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  }

  it('re-subscribes and re-registers the new subscription on the backend', async () => {
    const scope = createServiceWorkerScope();
    stubFetch(scope, {
      endpoint: 'https://push.example/new-device',
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    });
    const waited = [];
    scope.listeners.pushsubscriptionchange({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);

    expect(scope.registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    const registerCall = scope.fetch.mock.calls.find(
      ([url]) => String(url).endsWith('/subscriptions'),
    );
    expect(registerCall).toBeDefined();
    expect(JSON.parse(registerCall[1].body)).toMatchObject({
      endpoint: 'https://push.example/new-device',
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    });
  });

  it('does not re-subscribe when the server reports push as unavailable', async () => {
    const scope = createServiceWorkerScope();
    scope.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ public_key: null, available: false }),
    });
    const waited = [];
    scope.listeners.pushsubscriptionchange({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);

    expect(scope.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('swallows a failure instead of leaving an unhandled rejection', async () => {
    // There is no page in this context to report an error to; the page-side
    // reconciliation at the next boot is the second chance.
    const scope = createServiceWorkerScope();
    scope.fetch.mockRejectedValue(new Error('offline'));
    const waited = [];
    scope.listeners.pushsubscriptionchange({ waitUntil: (p) => waited.push(p) });
    await expect(Promise.all(waited)).resolves.toBeDefined();
  });
});
