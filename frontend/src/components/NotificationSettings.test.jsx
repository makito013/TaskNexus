// frontend/src/components/NotificationSettings.test.jsx
// The browser's `Notification` API is INJECTED (prop `notificationApi`),
// never touched for real: jsdom doesn't implement it, and a test depending
// on real notification permission wouldn't run in any CI.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NotificationSettings } from './NotificationSettings.jsx';
import { api } from '../services/api.js';

const DEFAULT_SETTINGS = {
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  server_utc_offset_minutes: -180,
  quiet_hours_active: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, 'fetchNotificationSettings').mockResolvedValue({ ...DEFAULT_SETTINGS });
});

const startInput = () => screen.getByLabelText('Silenciar a partir de');
const endInput = () => screen.getByLabelText('Voltar a notificar às');
const toggle = () => screen.getByLabelText('Silenciar em um horário fixo');

describe('NotificationSettings — loading', () => {
  it('shows the persisted quiet-hours range once loaded', async () => {
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('22:00'));
    expect(endInput().value).toBe('07:00');
  });

  it('reports a load failure instead of rendering a silently empty form', async () => {
    api.fetchNotificationSettings.mockRejectedValue(new Error('offline'));
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Falha ao carregar/));
  });
});

describe('NotificationSettings — quiet-hours toggle', () => {
  it('keeps the time fields disabled while quiet hours are off', async () => {
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput()).toBeTruthy());
    expect(toggle().checked).toBe(false);
    expect(startInput().disabled).toBe(true);
    expect(endInput().disabled).toBe(true);
  });

  it('enables the time fields when quiet hours are turned on', async () => {
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: true,
    });
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput()).toBeTruthy());

    fireEvent.click(toggle());

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ quiet_hours_enabled: true }));
    await waitFor(() => expect(startInput().disabled).toBe(false));
    expect(endInput().disabled).toBe(false);
  });

  it('turning quiet hours off does NOT clear the configured range', async () => {
    // The reason `quiet_hours_enabled` is its own field, and not the old
    // start === end sentinel.
    api.fetchNotificationSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: true,
      quiet_hours_start: '23:30',
      quiet_hours_end: '06:00',
    });
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: false,
      quiet_hours_start: '23:30',
      quiet_hours_end: '06:00',
    });
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('23:30'));

    fireEvent.click(toggle());

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ quiet_hours_enabled: false }));
    await waitFor(() => expect(startInput().disabled).toBe(true));
    expect(startInput().value).toBe('23:30');
    expect(endInput().value).toBe('06:00');
  });
});

describe('NotificationSettings — editing the times', () => {
  beforeEach(() => {
    api.fetchNotificationSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: true,
    });
  });

  it('saves the new start time on blur, not on every keystroke', async () => {
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: true,
      quiet_hours_start: '23:15',
    });
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('22:00'));

    fireEvent.change(startInput(), { target: { value: '23:15' } });
    expect(saveSpy).not.toHaveBeenCalled();

    fireEvent.blur(startInput());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ quiet_hours_start: '23:15' }));
  });

  it('saves the end time independently of the start time', async () => {
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      quiet_hours_enabled: true,
      quiet_hours_end: '08:30',
    });
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(endInput().value).toBe('07:00'));

    fireEvent.change(endInput(), { target: { value: '08:30' } });
    fireEvent.blur(endInput());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ quiet_hours_end: '08:30' }));
  });

  it('does not PUT when the field is blurred without a change', async () => {
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings');
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('22:00'));

    fireEvent.blur(startInput());
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('does not PUT an empty (half-typed) time value', async () => {
    const saveSpy = vi.spyOn(api, 'updateNotificationSettings');
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('22:00'));

    fireEvent.change(startInput(), { target: { value: '' } });
    fireEvent.blur(startInput());
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('surfaces a save failure without crashing', async () => {
    vi.spyOn(api, 'updateNotificationSettings').mockRejectedValue(new Error('422 horário inválido'));
    render(<NotificationSettings notificationApi={{ permission: 'granted' }} />);
    await waitFor(() => expect(startInput().value).toBe('22:00'));

    fireEvent.change(startInput(), { target: { value: '23:15' } });
    fireEvent.blur(startInput());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/422 horário inválido/));
  });
});

describe('NotificationSettings — browser permission', () => {
  it('explains the badge fallback when notifications are blocked', async () => {
    render(<NotificationSettings notificationApi={{ permission: 'denied' }} />);
    await waitFor(() => expect(startInput()).toBeTruthy());
    expect(screen.getByText(/bloqueadas nas configurações do navegador/)).toBeTruthy();
    // 'denied' is irreversible from JavaScript — there can't be a button
    // that pretends it can ask again.
    expect(screen.queryByText(/Pedir permissão/i)).toBeNull();
  });

  it('says the permission is asked on the first tap when still undecided', async () => {
    render(<NotificationSettings notificationApi={{ permission: 'default' }} />);
    await waitFor(() => expect(startInput()).toBeTruthy());
    expect(screen.getByText(/pedida no primeiro toque/)).toBeTruthy();
  });

  it('handles a browser with no Notification API at all', async () => {
    render(<NotificationSettings notificationApi={null} />);
    await waitFor(() => expect(startInput()).toBeTruthy());
    expect(screen.getByText(/não expõe a API de notificações/)).toBeTruthy();
  });
});

// ─── Web Push (Phase 3, decision G-2: explicit button, no auto-subscribe) ───
// The whole browser side arrives through the `push` prop: jsdom implements
// neither PushManager nor ServiceWorkerRegistration, and the point of the
// adapter object is that a test replaces it wholesale.

function createPushStub(overrides = {}) {
  return {
    isSupported: () => true,
    permission: () => 'granted',
    userAgent: () => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
    fetchPublicKey: vi.fn().mockResolvedValue({ public_key: 'AQID', available: true }),
    getExisting: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/a' }),
    unsubscribe: vi.fn().mockResolvedValue('https://push.example/a'),
    serialize: () => ({
      endpoint: 'https://push.example/a',
      keys: { p256dh: 'p', auth: 'a' },
    }),
    register: vi.fn().mockResolvedValue({ status: 'subscribed' }),
    unregister: vi.fn().mockResolvedValue({ status: 'unsubscribed' }),
    broadcast: vi.fn(),
    ...overrides,
  };
}

const enableButton = () => screen.getByRole('button', { name: /Ativar push neste dispositivo/ });
const disableButton = () => screen.getByRole('button', { name: /Desativar push neste dispositivo/ });

function renderWithPush(push) {
  return render(
    <NotificationSettings notificationApi={{ permission: 'granted' }} push={push} />,
  );
}

describe('NotificationSettings — push state', () => {
  it('offers an enabled button when push is available and not yet subscribed', async () => {
    renderWithPush(createPushStub());
    await waitFor(() => expect(enableButton().disabled).toBe(false));
  });

  it('never subscribes on its own while resolving the state (G-2)', async () => {
    // An unrequested permission prompt is the fastest way to get push
    // permanently denied — and 'denied' is irreversible from JavaScript.
    const push = createPushStub();
    renderWithPush(push);
    await waitFor(() => expect(enableButton()).toBeTruthy());
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it('shows the disable button when this device is already subscribed', async () => {
    const push = createPushStub({
      getExisting: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/a' }),
    });
    renderWithPush(push);
    await waitFor(() => expect(disableButton()).toBeTruthy());
    expect(screen.getByText(/mesmo com o navegador fechado/)).toBeTruthy();
  });

  it('disables the button and explains when the browser blocked notifications', async () => {
    const push = createPushStub({ permission: () => 'denied' });
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(true));
    expect(screen.getByText(/bloqueou as notificações neste aparelho/)).toBeTruthy();
  });

  it('disables the button when the browser has no push support at all', async () => {
    const push = createPushStub({ isSupported: () => false });
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(true));
  });

  it('tells an iOS user to install the app on the Home Screen', async () => {
    // The specific case required by decision G-2: on WebKit, PushManager
    // only exists once the PWA is installed, and a generic "unavailable"
    // would leave the user with no way forward.
    const push = createPushStub({
      isSupported: () => false,
      userAgent: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari',
    });
    renderWithPush(push);
    await waitFor(() => expect(screen.getByText(/Adicionar à Tela de Início/)).toBeTruthy());
  });

  it('reports the server having no VAPID key as unavailable', async () => {
    const push = createPushStub({
      fetchPublicKey: vi.fn().mockResolvedValue({ public_key: null, available: false }),
    });
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(true));
  });
});

describe('NotificationSettings — enabling push', () => {
  it('subscribes, registers on the backend and flips to the active state', async () => {
    const push = createPushStub();
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(false));

    fireEvent.click(enableButton());
    await waitFor(() => expect(disableButton()).toBeTruthy());
    expect(push.subscribe).toHaveBeenCalledWith('AQID');
    expect(push.register).toHaveBeenCalledWith({
      endpoint: 'https://push.example/a',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('broadcasts the change so the open tab stops playing its own sound', async () => {
    const push = createPushStub();
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(false));

    fireEvent.click(enableButton());
    await waitFor(() => expect(push.broadcast).toHaveBeenCalledWith(true));
  });

  it('surfaces a rejected permission prompt instead of failing silently', async () => {
    const push = createPushStub({
      subscribe: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      permission: vi.fn().mockReturnValueOnce('default').mockReturnValue('denied'),
    });
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(false));

    fireEvent.click(enableButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/NotAllowedError/));
    // Re-read state: the button must stop inviting a retry that can no
    // longer work.
    await waitFor(() => expect(enableButton().disabled).toBe(true));
  });

  it('does not claim success when the backend registration fails', async () => {
    const push = createPushStub({
      register: vi.fn().mockRejectedValue(new Error('Falha ao registrar este dispositivo')),
    });
    renderWithPush(push);
    await waitFor(() => expect(enableButton().disabled).toBe(false));

    fireEvent.click(enableButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Falha ao registrar/));
    expect(push.broadcast).not.toHaveBeenCalled();
  });
});

describe('NotificationSettings — disabling push', () => {
  it('unsubscribes in the browser and removes the backend row', async () => {
    const push = createPushStub({
      getExisting: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/a' }),
    });
    renderWithPush(push);
    await waitFor(() => expect(disableButton()).toBeTruthy());

    fireEvent.click(disableButton());
    await waitFor(() => expect(enableButton()).toBeTruthy());
    expect(push.unsubscribe).toHaveBeenCalled();
    // Without this the server keeps pushing to a device the user asked to
    // be left alone.
    expect(push.unregister).toHaveBeenCalledWith('https://push.example/a');
  });

  it('broadcasts the change so the open tab resumes its own sound', async () => {
    const push = createPushStub({
      getExisting: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/a' }),
    });
    renderWithPush(push);
    await waitFor(() => expect(disableButton()).toBeTruthy());

    fireEvent.click(disableButton());
    await waitFor(() => expect(push.broadcast).toHaveBeenCalledWith(false));
  });

  it('surfaces a failure to unsubscribe', async () => {
    const push = createPushStub({
      getExisting: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/a' }),
      unsubscribe: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderWithPush(push);
    await waitFor(() => expect(disableButton()).toBeTruthy());

    fireEvent.click(disableButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/boom/));
  });
});
