// frontend/src/hooks/useNotificationSettings.js
// Shared state for notification settings (GET/PUT
// /api/settings/notifications). Two independent consumers need the SAME
// value: the settings component (components/NotificationSettings.jsx) and
// the 7s poll (components/TerminalContext.jsx), which checks the quiet-hours
// window before playing the sound.
//
// Synchronization between them is a CustomEvent on window, not a new
// context: the settings component is mounted in isolation in the
// ConfiguracaoV2 tests (with no TerminalProvider around it), so coupling it
// to the terminal context would break that tree. The event also avoids the
// bad alternative of redoing the GET on every 7s tick — the setting rarely
// changes, and whoever changes it broadcasts it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

export const NOTIFICATION_SETTINGS_CHANGED_EVENT = 'tasknexus:notification-settings-changed';

/** Notifies every instance of the hook that the settings changed. */
function broadcast(settings) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_SETTINGS_CHANGED_EVENT, { detail: settings }),
  );
}

export function useNotificationSettings() {
  // null = hasn't loaded yet. Every consumer treats null as "no quiet-hours
  // window" (fail-open) instead of blocking the notification.
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Avoids setState after unmount (the GET can resolve late on an unstable
  // network via Tailscale).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api
      .fetchNotificationSettings()
      .then((data) => { if (mountedRef.current) setSettings(data); })
      .catch(() => {
        if (mountedRef.current) setError('Falha ao carregar as configurações de notificação.');
      })
      .finally(() => { if (mountedRef.current) setLoading(false); });
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event) => {
      if (event.detail) setSettings(event.detail);
    };
    window.addEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handler);
  }, []);

  /** Partial update. Returns the saved settings; propagates the error to
   * the caller to decide how to display it, while also exposing `error`
   * for whoever prefers that. */
  const save = useCallback(async (partial) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateNotificationSettings(partial);
      if (mountedRef.current) setSettings(updated);
      broadcast(updated);
      return updated;
    } catch (e) {
      const message = e.message || 'Falha ao salvar as configurações de notificação.';
      if (mountedRef.current) setError(message);
      throw e;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  return { settings, loading, saving, error, save };
}
