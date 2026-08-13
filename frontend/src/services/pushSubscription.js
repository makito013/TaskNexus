// frontend/src/services/pushSubscription.js
// BROWSER adapter for channel B (Web Push, Phase 3). This is the ONLY module
// in the app that touches `PushManager`/`navigator.serviceWorker` — same
// split as services/notifier.js for channel A: every browser API arrives by
// injection so the tests never depend on jsdom simulating a real
// ServiceWorkerRegistration.
//
// None of this works outside a SECURE CONTEXT (HTTPS via Tailscale, or
// localhost). Over a plain LAN IP the browser doesn't even register the
// service worker, and `isPushSupported()` reports false — which is what the
// Settings UI turns into "unavailable on this device".

/**
 * Broadcast channel between the Settings screen (which turns push on/off)
 * and the 7s poll in TerminalContext (which needs to know whether THIS
 * device receives pushes before it suppresses its own sound).
 *
 * A CustomEvent on window, not a context — exactly the reasoning already
 * documented in hooks/useNotificationSettings.js: the settings component is
 * mounted in isolation in its own tests, with no TerminalProvider around it.
 */
export const PUSH_SUBSCRIPTION_CHANGED_EVENT = 'tasknexus:push-subscription-changed';

/** @param {boolean} active whether this device now has a subscription. */
export function broadcastPushSubscriptionChange(active) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PUSH_SUBSCRIPTION_CHANGED_EVENT, { detail: { active } }),
  );
}

/**
 * Converts the base64url applicationServerKey the backend serves into the
 * Uint8Array `pushManager.subscribe()` demands. Passing the string straight
 * through fails with an opaque DOMException.
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * PushSubscription -> the body the backend expects.
 * `subscription.toJSON()` is the standard serialization; reading `.endpoint`
 * and `getKey()` by hand would mean base64-encoding the raw ArrayBuffers
 * here for no gain.
 *
 * @returns {{endpoint: string, keys: {p256dh: string, auth: string}}|null}
 *   null when the subscription has no usable keys (never happens on a real
 *   subscribe, but a stubbed/partial object must not blow up the caller).
 */
export function serializeSubscription(subscription) {
  if (!subscription?.toJSON) return null;
  const json = subscription.toJSON();
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

/**
 * Whether this browser can do Web Push at all. False on iOS Safari when the
 * app has NOT been added to the Home Screen: WebKit only exposes PushManager
 * to an installed PWA, which is why the Settings screen has a message
 * specifically about that case.
 */
export function isPushSupported(nav = typeof navigator === 'undefined' ? null : navigator) {
  return Boolean(nav && 'serviceWorker' in nav && typeof PushManager !== 'undefined');
}

/**
 * The active ServiceWorkerRegistration.
 *
 * main.jsx registers the worker at boot and discards the registration, so
 * there is no registration held anywhere in the React tree — this awaits
 * `navigator.serviceWorker.ready` instead of threading one through. That
 * promise resolves once the worker is active and never rejects; the timeout
 * exists because it also never resolves when registration silently failed
 * (an insecure context, most commonly), and the Settings button would hang
 * forever on "activating…".
 */
export async function getServiceWorkerRegistration({
  nav = typeof navigator === 'undefined' ? null : navigator,
  timeoutMs = 10000,
} = {}) {
  if (!nav?.serviceWorker) return null;
  let timer;
  try {
    return await Promise.race([
      nav.serviceWorker.ready,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The subscription this device already has, if any. Used to show the current
 * state in Settings without asking the browser for permission again.
 */
export async function getExistingSubscription(registration) {
  if (!registration?.pushManager?.getSubscription) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribes this device. `userVisibleOnly: true` is not optional — Chromium
 * rejects any subscription without it, because a silent push is not allowed.
 *
 * Lets the browser's error propagate (unlike the read-only helpers above):
 * the caller is an explicit user action with a button to report failure on,
 * and swallowing it would leave the button looking like it did nothing.
 */
export async function subscribeToPush(registration, publicKey) {
  if (!registration?.pushManager?.subscribe) {
    throw new Error('Push indisponível neste dispositivo');
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

/**
 * Boot-time reconciliation: reports whether this device is subscribed and,
 * if so, re-registers it on the backend.
 *
 * Two failure modes this repairs, both silent otherwise:
 * - The backend was offline (or restarting) when the user pressed
 *   "enable push": the browser subscription exists, but no row does, so
 *   nothing is ever pushed to this device again.
 * - The backend's database was reset while the browser kept its
 *   subscription.
 *
 * The POST is idempotent by endpoint, so re-registering an already-known
 * device costs one request and changes nothing.
 *
 * @param {(subscription: object) => Promise<any>} params.registerSubscription
 *   injected (api.registerPushSubscription) so this module keeps its only
 *   dependency on browser APIs.
 * @returns {Promise<boolean>} whether this device has an active subscription.
 */
export async function reconcilePushSubscription({
  registerSubscription,
  getRegistration = getServiceWorkerRegistration,
} = {}) {
  const registration = await getRegistration();
  const subscription = await getExistingSubscription(registration);
  const serialized = serializeSubscription(subscription);
  if (!serialized) return false;
  try {
    await registerSubscription?.(serialized);
  } catch {
    // The device IS subscribed either way — a failed re-registration is a
    // network problem, not a reason to start playing a duplicate sound.
  }
  return true;
}

/**
 * Cancels this device's subscription in the BROWSER. Removing it from the
 * backend is the caller's job (api.deletePushSubscription) — the endpoint is
 * needed for that and is gone once unsubscribe() resolves, which is why this
 * returns it.
 *
 * @returns {Promise<string|null>} the endpoint that was unsubscribed.
 */
export async function unsubscribeFromPush(registration) {
  const subscription = await getExistingSubscription(registration);
  if (!subscription) return null;
  const { endpoint } = subscription;
  try {
    await subscription.unsubscribe();
  } catch {
    // The browser already dropped it, or refuses to: the backend row still
    // has to go, so the endpoint is returned either way.
  }
  return endpoint;
}
