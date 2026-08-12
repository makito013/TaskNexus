// frontend/src/hooks/useServiceWorker.js
//
// Named like the project's other `use*` hooks for consistency, but exports a
// plain async function rather than a React hook: it is called once from
// main.jsx, before <App/> even mounts (see the call site there), where no
// component tree exists yet to host a useEffect. Making it a hook would
// force it into a component just to satisfy the Rules of Hooks, adding a
// render cycle for something that only needs to run once at boot.
//
// Fire-and-forget by design, same spirit as the `api.fetchAppearance()
// .catch()` call already in main.jsx: registration failure must never break
// app boot. That's why this function never rejects — every failure path is
// caught internally and reported through the returned `error` field instead
// of a rejected promise.

/**
 * Registers the PWA service worker (frontend/public/sw.js) if the browser
 * supports the API. Resolves to `{ supported, registration, error }` —
 * `registration` is returned (instead of void) because Phase 3 (Web
 * Push/VAPID) will need it to create a push subscription; that's forward
 * compatibility this phase can hand over cheaply.
 *
 * @returns {Promise<{ supported: boolean, registration: ServiceWorkerRegistration | null, error: Error | null }>}
 */
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, registration: null, error: null };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return { supported: true, registration, error: null };
  } catch (error) {
    return { supported: true, registration: null, error };
  }
}
