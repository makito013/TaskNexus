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
