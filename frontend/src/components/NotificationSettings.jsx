// frontend/src/components/NotificationSettings.jsx
// "Notifications" section of the Settings screen (layouts/v2/ConfiguracaoV2.jsx),
// in the same shape as ProjectsRootSetting.jsx: a self-contained component
// that fetches and saves its own settings, without depending on any context.
//
// Phase 1 of the end-of-chat notification feature: what exists here is only
// the QUIET-HOURS WINDOW. There's no master sound/notification toggle
// because there isn't one in the contract (/api/settings/notifications) —
// whoever controls whether the OS notification appears is the browser's own
// permission, and it's not changeable from JavaScript once denied.
//
// `quiet_hours_enabled` is its OWN boolean: with it off the time fields show
// up disabled (they don't disappear) and the configured value stays saved —
// turning it back on doesn't require typing everything again. `start ===
// end` is NO LONGER the signal for "off".
//
// Saving: the toggle saves right away (one action, one effect). The time
// fields save on `onBlur`/confirmed change, not on every keystroke — an
// <input type="time"> emits invalid intermediate values while the user types
// ("2:" -> "22:" -> "22:0"), and each one would turn into a 422 PUT.

import { useEffect, useState } from 'react';
import { useNotificationSettings } from '../hooks/useNotificationSettings.js';

const styles = {
  wrap: {
    padding: '12px 10px',
    borderTop: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  heading: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--v2-text-faint, var(--text-muted, #666666))',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  hint: {
    fontSize: '11px',
    color: 'var(--v2-text-dim, var(--text-secondary, #888888))',
    lineHeight: 1.4,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    cursor: 'pointer',
  },
  timeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  timeField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  timeLabel: {
    fontSize: '10px',
    color: 'var(--v2-text-faint, var(--text-muted, #666666))',
  },
  timeInput: {
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    background: 'var(--v2-surface-2, var(--bg-surface-2, #141414))',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    fontSize: '12px',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  error: {
    fontSize: '11px',
    color: 'var(--v2-danger, var(--destructive, #ff3333))',
  },
};

/** Text for the browser's permission state. Informational only: 'denied' is
 * irreversible from JavaScript, so there's no "ask again" button — the
 * warning lets the user know they need to re-enable it in the browser's
 * settings, and that until then the badge/title is the notification that
 * remains. */
function permissionHint(permission) {
  if (permission === 'granted') return 'O navegador já autorizou as notificações neste dispositivo.';
  if (permission === 'denied') {
    return 'As notificações estão bloqueadas nas configurações do navegador. Enquanto isso, o aviso continua no contador do título da aba e no badge da lista de chats.';
  }
  if (permission === 'unsupported') return 'Este navegador não expõe a API de notificações.';
  return 'A permissão de notificação é pedida no primeiro toque/clique na página.';
}

/** `notificationApi` is injectable only for tests — in production it's the
 * global `Notification`. No other browser API is touched here. */
export function NotificationSettings({
  notificationApi = typeof Notification === 'undefined' ? null : Notification,
}) {
  const { settings, loading, saving, error, save } = useNotificationSettings();
  // Local copy of the times so the input stays controlled while the user
  // edits, without sending a PUT per keystroke.
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!settings) return;
    setStart(settings.quiet_hours_start);
    setEnd(settings.quiet_hours_end);
  }, [settings]);

  if (loading) {
    return (
      <div style={styles.wrap}>
        <div style={styles.heading}>Notificações</div>
        <div style={styles.hint}>Carregando…</div>
      </div>
    );
  }

  const enabled = Boolean(settings?.quiet_hours_enabled);

  const handleToggle = (event) => {
    save({ quiet_hours_enabled: event.target.checked }).catch(() => {});
  };

  // Only sends the PUT if the value actually changed and is a complete time
  // — <input type="time"> returns '' while it's incomplete.
  const commitTime = (field, value, previous) => {
    if (!value || value === previous) return;
    save({ [field]: value }).catch(() => {});
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>Notificações</div>
      <div style={styles.hint}>
        Quando um chat termina, o TaskNexus toca um som e mostra uma notificação do
        navegador. {permissionHint(notificationApi?.permission ?? 'unsupported')}
      </div>

      <label style={styles.toggleRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleToggle}
          disabled={saving}
        />
        Silenciar em um horário fixo
      </label>

      {/* The fields stay VISIBLE and disabled when the window is off,
          instead of disappearing: the configured time stays saved on the
          backend, and hiding it would give the impression it was lost. */}
      <div style={styles.timeRow}>
        <div style={styles.timeField}>
          <label style={styles.timeLabel} htmlFor="quiet-hours-start">Silenciar a partir de</label>
          <input
            id="quiet-hours-start"
            type="time"
            style={styles.timeInput}
            value={start}
            disabled={!enabled || saving}
            onChange={(e) => setStart(e.target.value)}
            onBlur={() => commitTime('quiet_hours_start', start, settings?.quiet_hours_start)}
          />
        </div>
        <div style={styles.timeField}>
          <label style={styles.timeLabel} htmlFor="quiet-hours-end">Voltar a notificar às</label>
          <input
            id="quiet-hours-end"
            type="time"
            style={styles.timeInput}
            value={end}
            disabled={!enabled || saving}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={() => commitTime('quiet_hours_end', end, settings?.quiet_hours_end)}
          />
        </div>
      </div>

      {enabled && (
        <div style={styles.hint}>
          O horário segue o relógio do servidor, não o do aparelho — acessar de outro
          fuso não desloca a janela.
        </div>
      )}

      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}
