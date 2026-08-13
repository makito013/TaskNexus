// frontend/src/services/pushSubscription.test.js
// Every browser API here is a STUB passed by injection — no test in this
// file relies on jsdom providing a real PushManager/ServiceWorkerRegistration
// (it doesn't provide either).

import { describe, it, expect, vi } from 'vitest';
import {
  urlBase64ToUint8Array,
  serializeSubscription,
  isPushSupported,
  getServiceWorkerRegistration,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from './pushSubscription.js';

function fakeSubscription({
  endpoint = 'https://push.example/device-a',
  p256dh = 'p256dh-value',
  auth = 'auth-value',
  unsubscribe = vi.fn().mockResolvedValue(true),
} = {}) {
  return {
    endpoint,
    unsubscribe,
    toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
  };
}

function fakeRegistration({ existing = null, subscribed = fakeSubscription() } = {}) {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(existing),
      subscribe: vi.fn().mockResolvedValue(subscribed),
    },
  };
}

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url string', () => {
    // 'AQID' is base64 for the bytes 1, 2, 3.
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });

  it('restores the missing padding', () => {
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1]);
  });

  it('translates the url-safe alphabet back to standard base64', () => {
    // The VAPID public key routinely contains '-' and '_'; treating them as
    // literal characters produces a key the browser rejects.
    const urlSafe = '-_8';
    expect(Array.from(urlBase64ToUint8Array(urlSafe))).toEqual([251, 255]);
  });

  it('returns a Uint8Array, not a string', () => {
    expect(urlBase64ToUint8Array('AQID')).toBeInstanceOf(Uint8Array);
  });
});

describe('serializeSubscription', () => {
  it('extracts endpoint and both keys', () => {
    expect(serializeSubscription(fakeSubscription())).toEqual({
      endpoint: 'https://push.example/device-a',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    });
  });

  it('returns null for a subscription without keys', () => {
    expect(serializeSubscription({ toJSON: () => ({ endpoint: 'https://x' }) })).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(serializeSubscription(null)).toBeNull();
    expect(serializeSubscription(undefined)).toBeNull();
  });
});

describe('isPushSupported', () => {
  it('is false without a navigator', () => {
    expect(isPushSupported(null)).toBe(false);
  });

  it('is false when the browser has no service worker support', () => {
    expect(isPushSupported({})).toBe(false);
  });

  it('is false when PushManager is missing (iOS Safari without an installed PWA)', () => {
    const original = globalThis.PushManager;
    delete globalThis.PushManager;
    try {
      expect(isPushSupported({ serviceWorker: {} })).toBe(false);
    } finally {
      if (original !== undefined) globalThis.PushManager = original;
    }
  });

  it('is true when both APIs are present', () => {
    const original = globalThis.PushManager;
    globalThis.PushManager = function PushManagerStub() {};
    try {
      expect(isPushSupported({ serviceWorker: {} })).toBe(true);
    } finally {
      if (original === undefined) delete globalThis.PushManager;
      else globalThis.PushManager = original;
    }
  });
});

describe('getServiceWorkerRegistration', () => {
  it('resolves with the ready registration', async () => {
    const registration = fakeRegistration();
    const nav = { serviceWorker: { ready: Promise.resolve(registration) } };
    expect(await getServiceWorkerRegistration({ nav })).toBe(registration);
  });

  it('returns null without a navigator', async () => {
    expect(await getServiceWorkerRegistration({ nav: null })).toBeNull();
  });

  it('returns null instead of hanging forever when ready never resolves', async () => {
    // `navigator.serviceWorker.ready` never settles when registration
    // silently failed (an insecure context is the usual cause) — without the
    // timeout the Settings button would sit on "activating…" forever.
    const nav = { serviceWorker: { ready: new Promise(() => {}) } };
    expect(await getServiceWorkerRegistration({ nav, timeoutMs: 5 })).toBeNull();
  });

  it('returns null when ready rejects', async () => {
    const nav = { serviceWorker: { ready: Promise.reject(new Error('nope')) } };
    expect(await getServiceWorkerRegistration({ nav, timeoutMs: 50 })).toBeNull();
  });
});

describe('getExistingSubscription', () => {
  it('returns the existing subscription', async () => {
    const existing = fakeSubscription();
    const registration = fakeRegistration({ existing });
    expect(await getExistingSubscription(registration)).toBe(existing);
  });

  it('returns null when there is none', async () => {
    expect(await getExistingSubscription(fakeRegistration())).toBeNull();
  });

  it('returns null without a registration', async () => {
    expect(await getExistingSubscription(null)).toBeNull();
  });

  it('returns null when the browser throws', async () => {
    const registration = {
      pushManager: { getSubscription: vi.fn().mockRejectedValue(new Error('boom')) },
    };
    expect(await getExistingSubscription(registration)).toBeNull();
  });
});

describe('subscribeToPush', () => {
  it('subscribes with userVisibleOnly and the decoded key', async () => {
    const registration = fakeRegistration();
    await subscribeToPush(registration, 'AQID');
    const options = registration.pushManager.subscribe.mock.calls[0][0];
    // userVisibleOnly is not optional: Chromium rejects a subscription
    // without it outright.
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual([1, 2, 3]);
  });

  it('returns the new subscription', async () => {
    const subscribed = fakeSubscription();
    const registration = fakeRegistration({ subscribed });
    expect(await subscribeToPush(registration, 'AQID')).toBe(subscribed);
  });

  it('throws when the registration cannot subscribe', async () => {
    // The caller is an explicit button press and needs to report failure —
    // swallowing this would leave the button looking inert.
    await expect(subscribeToPush(null, 'AQID')).rejects.toThrow();
  });

  it('propagates a permission rejection from the browser', async () => {
    const registration = fakeRegistration();
    registration.pushManager.subscribe.mockRejectedValue(new Error('NotAllowedError'));
    await expect(subscribeToPush(registration, 'AQID')).rejects.toThrow('NotAllowedError');
  });
});

describe('unsubscribeFromPush', () => {
  it('unsubscribes and returns the endpoint so the backend row can go too', async () => {
    const subscription = fakeSubscription();
    const registration = fakeRegistration({ existing: subscription });
    const endpoint = await unsubscribeFromPush(registration);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(endpoint).toBe('https://push.example/device-a');
  });

  it('returns null when there is nothing to unsubscribe', async () => {
    expect(await unsubscribeFromPush(fakeRegistration())).toBeNull();
  });

  it('still returns the endpoint when the browser refuses to unsubscribe', async () => {
    // The backend row has to go regardless — otherwise the server keeps
    // pushing to a device the user asked to be left alone.
    const subscription = fakeSubscription({
      unsubscribe: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const registration = fakeRegistration({ existing: subscription });
    expect(await unsubscribeFromPush(registration)).toBe('https://push.example/device-a');
  });
});
