// frontend/src/hooks/useServiceWorker.test.js
// Phase 2 (PWA installability plan): covers registerServiceWorker's
// contract — calls navigator.serviceWorker.register('/sw.js', ...) when the
// API exists, doesn't throw when it doesn't, and never turns a rejected
// register() into an unhandled rejection (the whole point of returning
// `error` instead of throwing).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker } from './useServiceWorker.js';

describe('registerServiceWorker — API available', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete navigator.serviceWorker;
  });

  it('registers /sw.js with scope "/" and returns the registration', async () => {
    const fakeRegistration = { scope: '/' };
    const register = vi.fn(() => Promise.resolve(fakeRegistration));
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });

    const result = await registerServiceWorker();

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(result).toEqual({ supported: true, registration: fakeRegistration, error: null });
  });

  it('captures a rejected register() instead of throwing', async () => {
    const registrationError = new Error('registration failed');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: vi.fn(() => Promise.reject(registrationError)) },
      configurable: true,
    });

    // No try/catch here on purpose: an unhandled rejection would fail the
    // test on its own if registerServiceWorker let it propagate.
    const result = await registerServiceWorker();

    expect(result).toEqual({ supported: true, registration: null, error: registrationError });
  });
});

describe('registerServiceWorker — API unavailable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with supported=false and does not throw when serviceWorker is not in navigator', async () => {
    // jsdom's navigator does not define serviceWorker by default; this
    // documents that as the intentional baseline rather than an accident.
    expect('serviceWorker' in navigator).toBe(false);

    await expect(registerServiceWorker()).resolves.toEqual({
      supported: false,
      registration: null,
      error: null,
    });
  });
});
