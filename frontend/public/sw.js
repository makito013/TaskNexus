// TaskNexus service worker — Phase 2 (PWA installability infrastructure).
//
// This file is copied verbatim by Vite (anything under frontend/public/ is
// not bundled), so it must stay classic self-contained JS: no `import` of
// project modules, no build-time transforms to rely on.
//
// Scope is intentionally minimal for this phase: just enough for the app to
// be installable (a registered service worker is a PWA installability
// requirement on Chromium/Android). No caching strategy and no push/
// notificationclick handling yet — those are Phase 3 (Web Push/VAPID),
// which will extend this same file rather than replace it.

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
// no service worker were present. A cache-first strategy is Phase 3 scope —
// this listener only exists so the app already has an active fetch handler
// to build on.
self.addEventListener('fetch', () => {});
