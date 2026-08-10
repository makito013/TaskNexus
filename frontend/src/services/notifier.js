// frontend/src/services/notifier.js
// BROWSER adapter for channel A (sound + Web Notification on the open tab).
// This is the ONLY module in the feature that touches
// `Notification`/`AudioContext` directly — all logic with edge cases (quiet
// hours, transition detection, notification text) lives in pure functions in
// utils/quietHours.js and utils/sessionNotifications.js, and the
// TerminalProvider receives this object by injection, so tests pass a stub
// and never depend on jsdom simulating real browser APIs.
//
// Two browser policies handled here, both requiring a user GESTURE and
// therefore resolved in the same single "first touch" listener:
//
// 1. **Audio autoplay.** An AudioContext created without a gesture is born
//    'suspended' and nothing plays. `unlock()` calls `resume()` and fires a
//    zero-gain sound just so the browser marks the context as "activated by
//    gesture". This does NOT solve 100% of cases: if Bruno opens the tab and
//    never clicks anything, the first sound doesn't play — there's no way
//    around this in JavaScript, it's browser policy. On iOS, sound with the
//    tab in the background only really works once the PWA is installed
//    (Phase 2/3).
//
// 2. **`Notification.requestPermission()`.** On WebKit (Bruno's
//    iPad/iPhone) it's only accepted from a user gesture — requesting it on
//    page load is silently rejected. If permission is already 'denied',
//    there's no way to ask again from code: the fallback is the badge/title
//    that Phase 4 already delivers, and which keeps working untouched.

// Two short, rising, high-pitched notes — synthesized instead of embedding
// an audio file: avoids a binary in the repo and one extra request.
const TONE_SEQUENCE = [
  { frequency: 880, startOffset: 0, duration: 0.14 },
  { frequency: 1174.66, startOffset: 0.16, duration: 0.2 },
];
const PEAK_GAIN = 0.18;

function scheduleTone(audioContext, { frequency, startOffset, duration }, startAt) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  const begin = startAt + startOffset;
  // Short envelope: without it, turning the oscillator on/off abruptly
  // produces an audible "click" at the edges.
  gain.gain.setValueAtTime(0.0001, begin);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, begin + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, begin + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(begin);
  oscillator.stop(begin + duration + 0.02);
}

/**
 * @param {object} deps Injectable for tests — in production they stay at
 *   the defaults.
 * @param {typeof Notification} [deps.notificationApi]
 * @param {() => AudioContext} [deps.audioContextFactory]
 */
export function createBrowserNotifier({
  notificationApi = typeof Notification === 'undefined' ? null : Notification,
  audioContextFactory = defaultAudioContextFactory,
} = {}) {
  let audioContext = null;
  let unlocked = false;

  function ensureAudioContext() {
    if (audioContext) return audioContext;
    try {
      audioContext = audioContextFactory();
    } catch (e) {
      // Browser without Web Audio, or a refused context: the visual
      // notification still stands, so this can't take down the rest of the
      // channel.
      console.warn('[notifier] Web Audio indisponível — seguindo sem som', e);
      audioContext = null;
    }
    return audioContext;
  }

  return {
    /** Called on the user's first gesture. Idempotent. */
    async unlock() {
      if (unlocked) return;
      unlocked = true;
      const context = ensureAudioContext();
      if (context?.state === 'suspended') {
        try {
          await context.resume();
        } catch (e) {
          console.warn('[notifier] AudioContext.resume() falhou', e);
        }
      }
      // 'default' = haven't asked yet. 'denied' is irreversible from
      // JavaScript — don't insist, the badge/title remains the warning.
      if (notificationApi?.permission === 'default') {
        try {
          await notificationApi.requestPermission();
        } catch (e) {
          console.warn('[notifier] requestPermission falhou', e);
        }
      }
    },

    playSound() {
      const context = ensureAudioContext();
      if (!context) return;
      if (context.state === 'suspended') {
        // No prior gesture yet: the browser blocks it. Tries to unlock so
        // the NEXT notification gets through, and silently gives up on
        // this one.
        context.resume?.().catch(() => {});
        return;
      }
      try {
        const startAt = context.currentTime;
        for (const tone of TONE_SEQUENCE) scheduleTone(context, tone, startAt);
      } catch (e) {
        console.warn('[notifier] falha ao tocar o som de notificação', e);
      }
    },

    /** @param {{title: string, body: string, tag: string}} content */
    notify({ title, body, tag }) {
      if (!notificationApi || notificationApi.permission !== 'granted') return null;
      try {
        // Without `renotify`: a new notification with the same `tag`
        // silently replaces the previous one, which is exactly the "one
        // notification per session" requested by the PO.
        // `requireInteraction` keeps the alert in the OS notification center
        // until dismissed by hand (no disappearing on its own).
        return new notificationApi(title, { body, tag, requireInteraction: true });
      } catch (e) {
        console.warn('[notifier] falha ao criar a Web Notification', e);
        return null;
      }
    },

    get permission() {
      return notificationApi?.permission ?? 'unsupported';
    },
  };
}

function defaultAudioContextFactory() {
  const AudioContextCtor =
    typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('AudioContext indisponível neste browser');
  return new AudioContextCtor();
}

/**
 * Registers the "first gesture" listener that unlocks audio and requests
 * notification permission. Returns the cleanup function.
 * `once: true` makes the browser remove each listener on its own after the
 * first firing — the cleanup covers unmounting before that happens.
 */
export function installUnlockOnFirstGesture(notifier, target = typeof window === 'undefined' ? null : window) {
  if (!target?.addEventListener) return () => {};
  const handler = () => { notifier.unlock(); };
  const events = ['pointerdown', 'keydown', 'touchend'];
  for (const event of events) target.addEventListener(event, handler, { once: true, passive: true });
  return () => {
    for (const event of events) target.removeEventListener(event, handler);
  };
}
