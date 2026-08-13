// TaskNexus service worker — PWA installability (Phase 2) + Web Push
// delivery (Phase 3).
//
// This file is copied verbatim by Vite (anything under frontend/public/ is
// not bundled), so it must stay classic self-contained JS: no `import` of
// project modules, no build-time transforms to rely on. That constraint is
// also why the base64url helper below is duplicated from
// src/services/pushSubscription.js instead of being shared — a service
// worker cannot import from the bundle.
//
// Everything here only works in a SECURE CONTEXT: HTTPS (Tailscale) or
// localhost. Over a plain LAN IP the browser refuses to register the worker
// at all, and push fails silently with no error the user can see.

// Base path of the push API, so the two fetches below stay in one place.
const PUSH_API = '/api/push';

self.addEventListener('install', () => {
  // Activate this service worker as soon as it finishes installing, instead
  // of waiting for all open tabs of the old version to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any already-open clients immediately, so the first
  // install doesn't require a reload before the service worker is active.
  event.waitUntil(self.clients.claim());
});

// Registered on purpose, but deliberately a no-op: NOT calling
// event.respondWith() lets every request fall through to the network as if
// no service worker were present. There is still no caching strategy — this
// listener only exists so the app has an active fetch handler to build on.
self.addEventListener('fetch', () => {});

// ─── Push delivery ──────────────────────────────────────────────────────

/**
 * Reads the notification content out of the push event.
 * Falls back to a generic message instead of throwing: a push whose body
 * failed to parse must still surface SOMETHING, otherwise the user just
 * never hears about the finished chat.
 */
function readPushPayload(event) {
  const fallback = { title: 'TaskNexus', body: 'Um chat terminou.', tag: 'tasknexus', data: {} };
  if (!event.data) return fallback;
  try {
    const parsed = event.data.json();
    return {
      title: parsed.title || fallback.title,
      body: parsed.body || fallback.body,
      tag: parsed.tag || fallback.tag,
      data: parsed.data || {},
    };
  } catch (e) {
    return fallback;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  // waitUntil is mandatory, not defensive: without it the browser may kill
  // the worker before showNotification() resolves, and the notification
  // silently never appears.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // tag = session_key implements the PO's "one notification per
      // session": a new push for the same chat REPLACES the previous one
      // instead of stacking. Without `renotify`, that replacement is silent
      // (no repeated system sound/vibration).
      tag: payload.tag,
      data: payload.data,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Asks the platform to keep the alert until dismissed by hand. Honoured
      // on Chromium desktop; other platforms ignore it. It is a hint, not a
      // guarantee, and nothing in the UI promises otherwise.
      requireInteraction: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionKey = (event.notification.data && event.notification.data.session_key) || '';
  event.waitUntil(focusOrOpen(sessionKey));
});

/**
 * Focuses an already-open TaskNexus window when there is one, and only opens
 * a new one otherwise — clicking the notification must never leave the user
 * with a second copy of the app.
 *
 * `includeUncontrolled: true` matters: a tab loaded before this worker took
 * control is not "controlled" by it, and would be invisible here.
 */
async function focusOrOpen(sessionKey) {
  const url = sessionKey ? '/?session=' + encodeURIComponent(sessionKey) : '/';
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if ('focus' in client) {
      // navigate() before focus so an already-open window switches to the
      // clicked chat instead of staying on whatever was on screen. It can
      // reject (cross-origin, or an unsupported browser) — focusing is the
      // part that must not be lost, so the failure is swallowed.
      if ('navigate' in client && sessionKey) {
        try {
          await client.navigate(url);
        } catch (e) {
          /* keeps the current URL and just focuses */
        }
      }
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

// ─── Subscription rotation ──────────────────────────────────────────────

// The browser can invalidate a push subscription on its own (key rotation,
// long inactivity, a storage purge) and fires this event with the OLD
// subscription. Without re-subscribing here, push simply stops working one
// day and the only fix is the user noticing and toggling it off/on by hand.
//
// The re-subscribe is written out longhand instead of reusing
// services/pushSubscription.js: a service worker cannot import from the
// bundle (see the header).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe());
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function resubscribe() {
  try {
    const keyResponse = await fetch(PUSH_API + '/vapid-public-key');
    if (!keyResponse.ok) return;
    const { public_key: publicKey, available } = await keyResponse.json();
    if (!available || !publicKey) return;

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = subscription.toJSON();
    await fetch(PUSH_API + '/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        user_agent: self.navigator ? self.navigator.userAgent : null,
      }),
    });
  } catch (e) {
    // Nothing here can be surfaced to the user — there is no page in this
    // context. The page-side reconciliation on the next boot
    // (services/pushSubscription.js) is the second chance.
  }
}
