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

import { useCallback, useEffect, useState } from 'react';
import { useNotificationSettings } from '../hooks/useNotificationSettings.js';
import { api } from '../services/api.js';
import {
  broadcastPushSubscriptionChange,
  getExistingSubscription,
  getServiceWorkerRegistration,
  isPushSupported,
  serializeSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/pushSubscription.js';

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
  pushBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingTop: '4px',
  },
  pushButton: {
    alignSelf: 'flex-start',
    padding: '7px 12px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    background: 'var(--v2-surface-2, var(--bg-surface-2, #141414))',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    fontSize: '12px',
    cursor: 'pointer',
  },
  pushButtonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
  },
};

// ─── Web Push (channel B) ──────────────────────────────────────────────────
// Decision G-2: an EXPLICIT button, never a silent auto-subscribe at boot.
// Subscribing triggers the browser's permission prompt, and a prompt the
// user didn't ask for is the fastest way to get push permanently denied —
// which is irreversible from JavaScript.

/** The four states the button reports, plus 'loading' while resolving. */
const PUSH_STATE = {
  LOADING: 'loading',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
};

/** Whether this looks like iOS/iPadOS, where PushManager only exists once
 * the app has been added to the Home Screen. Used only to pick the message
 * — never to gate behaviour, which is decided by feature detection. */
function looksLikeIos(userAgent = '') {
  return /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(userAgent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
}

function pushStateHint(state, { isIos }) {
  if (state === PUSH_STATE.LOADING) return 'Verificando…';
  if (state === PUSH_STATE.ACTIVE) {
    return 'Este dispositivo recebe notificações mesmo com o navegador fechado. O som toca no aparelho, não na aba.';
  }
  if (state === PUSH_STATE.DENIED) {
    // Deliberately worded differently from permissionHint() above so the
    // two blocks never read as the same sentence repeated twice.
    return 'O navegador bloqueou as notificações neste aparelho, então o push não pode ser ativado. Reative a permissão nas configurações do navegador e recarregue a página.';
  }
  if (state === PUSH_STATE.UNAVAILABLE) {
    if (isIos) {
      return 'No iPhone/iPad o push só funciona com o app instalado: abra o menu de compartilhar do Safari e escolha "Adicionar à Tela de Início". Depois abra o TaskNexus por esse ícone e volte aqui.';
    }
    return 'Este dispositivo não oferece push. Ele exige HTTPS (o endereço do Tailscale) ou localhost — por IP da rede local o navegador nem registra o service worker.';
  }
  return 'Ative para receber a notificação no aparelho mesmo com o navegador fechado. É por dispositivo: cada aparelho precisa ativar o seu.';
}

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

/** Every browser API used here arrives by injection (`notificationApi`,
 * `push`) — jsdom implements neither `Notification` nor `PushManager`, and a
 * test that depended on real permission wouldn't run anywhere. In production
 * they default to the real ones. */
export function NotificationSettings({
  notificationApi = typeof Notification === 'undefined' ? null : Notification,
  push = defaultPushAdapter,
}) {
  const { settings, loading, saving, error, save } = useNotificationSettings();
  // Local copy of the times so the input stays controlled while the user
  // edits, without sending a PUT per keystroke.
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [pushState, setPushState] = useState(PUSH_STATE.LOADING);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    if (!settings) return;
    setStart(settings.quiet_hours_start);
    setEnd(settings.quiet_hours_end);
  }, [settings]);

  const isIos = looksLikeIos(push.userAgent());

  /** Resolves the current state WITHOUT asking for permission: reading an
   * existing subscription never prompts. */
  const refreshPushState = useCallback(async () => {
    if (!push.isSupported()) {
      setPushState(PUSH_STATE.UNAVAILABLE);
      return;
    }
    let serverKey = null;
    try {
      serverKey = await push.fetchPublicKey();
    } catch {
      // Backend unreachable: don't claim "unavailable" (which reads as a
      // permanent verdict), let the button try and report a real error.
      serverKey = null;
    }
    if (serverKey && serverKey.available === false) {
      setPushState(PUSH_STATE.UNAVAILABLE);
      return;
    }
    const subscription = await push.getExisting();
    if (subscription) {
      setPushState(PUSH_STATE.ACTIVE);
      return;
    }
    setPushState(
      push.permission() === 'denied' ? PUSH_STATE.DENIED : PUSH_STATE.INACTIVE,
    );
  }, [push]);

  useEffect(() => {
    let cancelled = false;
    refreshPushState().catch(() => {
      if (!cancelled) setPushState(PUSH_STATE.UNAVAILABLE);
    });
    return () => { cancelled = true; };
  }, [refreshPushState]);

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      const { public_key: publicKey, available } = await push.fetchPublicKey();
      if (!available || !publicKey) {
        setPushState(PUSH_STATE.UNAVAILABLE);
        return;
      }
      const subscription = await push.subscribe(publicKey);
      const serialized = push.serialize(subscription);
      if (!serialized) throw new Error('O navegador devolveu uma inscrição incompleta.');
      await push.register(serialized);
      setPushState(PUSH_STATE.ACTIVE);
      push.broadcast(true);
    } catch (e) {
      // A rejected permission prompt lands here too — re-read the state so
      // the button turns into the 'denied' message instead of inviting a
      // retry that can no longer work.
      setPushError(
        isIos && !push.isSupported()
          ? 'Instale o TaskNexus na Tela de Início antes de ativar o push.'
          : e?.message || 'Não foi possível ativar o push neste dispositivo.',
      );
      await refreshPushState().catch(() => {});
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      const endpoint = await push.unsubscribe();
      // Removes the backend row even when the browser had already dropped
      // the subscription — otherwise the server keeps pushing to a device
      // the user asked to be left alone.
      if (endpoint) await push.unregister(endpoint);
      setPushState(PUSH_STATE.INACTIVE);
      push.broadcast(false);
    } catch (e) {
      setPushError(e?.message || 'Não foi possível desativar o push neste dispositivo.');
    } finally {
      setPushBusy(false);
    }
  };

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

      <div style={styles.pushBlock}>
        <div style={styles.heading}>Notificação com o navegador fechado</div>
        <div style={styles.hint}>{pushStateHint(pushState, { isIos })}</div>
        {pushState === PUSH_STATE.ACTIVE ? (
          <button
            type="button"
            style={{ ...styles.pushButton, ...(pushBusy ? styles.pushButtonDisabled : null) }}
            onClick={handleDisablePush}
            disabled={pushBusy}
          >
            Desativar push neste dispositivo
          </button>
        ) : (
          <button
            type="button"
            style={{
              ...styles.pushButton,
              ...(pushBusy || pushState !== PUSH_STATE.INACTIVE ? styles.pushButtonDisabled : null),
            }}
            onClick={handleEnablePush}
            // 'denied' and 'unavailable' are offered as a disabled button
            // rather than a live one: pressing it could not possibly work,
            // and a button that silently fails is worse than one that
            // visibly can't be pressed.
            disabled={pushBusy || pushState !== PUSH_STATE.INACTIVE}
          >
            Ativar push neste dispositivo
          </button>
        )}
        {pushError && <div role="alert" style={styles.error}>{pushError}</div>}
      </div>

      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}

/** Real browser/backend wiring, bundled into one object so tests replace it
 * wholesale with a stub instead of mocking five modules. */
const defaultPushAdapter = {
  isSupported: () => isPushSupported(),
  permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  userAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent),
  fetchPublicKey: () => api.fetchVapidPublicKey(),
  getExisting: async () => getExistingSubscription(await getServiceWorkerRegistration()),
  subscribe: async (publicKey) => subscribeToPush(await getServiceWorkerRegistration(), publicKey),
  unsubscribe: async () => unsubscribeFromPush(await getServiceWorkerRegistration()),
  serialize: (subscription) => serializeSubscription(subscription),
  register: (serialized) => api.registerPushSubscription(serialized),
  unregister: (endpoint) => api.deletePushSubscription(endpoint),
  broadcast: (active) => broadcastPushSubscriptionChange(active),
};
