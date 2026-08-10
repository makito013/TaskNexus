// frontend/src/components/TerminalContext.jsx
// Session lifecycle — Plan 03-02
//
// Key design decisions:
// - selectAgent: marks which agent is viewed (selection only, NO PTY spawn)
// - startSession: explicit mount that triggers PTY spawn via TerminalPanel WS open
// - terminateSession: kills PTY server-side then removes terminal from local state
// - activeSessions poll: drives sidebar dots AND mount/unmount reconciliation
// - Reload: sessions NOT restored from localStorage; only activeSessionKey is.
//   On mount, if server confirms the active key is still running, startSession is
//   called automatically. Otherwise the user sees StartChatCTA.
// - justStartedRef grace window: prevents a poll tick racing ahead of the server
//   spawn from spuriously unmounting a freshly-started session.
// - Plan 03-05 (D-13): the auto-remount effect below reverts CR-01 (03-REVIEW-FIX.md).
//   It now fires exactly once, for the activeSessionKey snapshot taken at provider
//   mount (page load/reload) — it NEVER re-fires for a later selectAgent call, even
//   when the newly-selected agent's PTY is confirmed alive server-side.
//
// Multi-chat (bugfix/feature round, 2026-07-02):
// - selectedProjectId: which project's tab strip / start buttons are shown in the
//   main panel. Decoupled from activeSessionKey so a project with zero started
//   sessions can still be "selected" (renders the per-agent start buttons).
// - selectProject: sidebar row click. Keeps showing the current tab if it still
//   belongs to the clicked project; otherwise falls back to any other mounted
//   session of that project; otherwise null (start-buttons view). Never spawns.
// - startNewInstance: builds a session key for "start chat {agent}". Reuses the
//   bare `projectId::agentId` key if it isn't already an open tab (this is what
//   lets an unmounted-but-alive server session be reconnected exactly like
//   before); otherwise appends a random suffix so multiple simultaneous chats
//   of the SAME agent type are distinct PTY/session-store entries. The backend
//   treats session_key as an opaque string, so no server-side change is needed.

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api.js';
import { createBrowserNotifier, installUnlockOnFirstGesture } from '../services/notifier.js';
import { decideSessionsToNotify, buildSessionNotification } from '../utils/sessionNotifications.js';
import { isQuietNow } from '../utils/quietHours.js';
import { NOTIFICATION_SETTINGS_CHANGED_EVENT } from '../hooks/useNotificationSettings.js';

const TerminalContext = createContext(null);

const POLL_INTERVAL_MS = 7000;
const JUST_STARTED_GRACE_MS = 10000; // 10s grace after explicit startSession

/** `notifier` is injectable only for tests (a stub in place of
 * Notification/AudioContext) — in production the default is the real
 * browser adapter. */
export function TerminalProvider({ children, notifier = null }) {
  // Selected agent (just UI selection, no PTY yet)
  const [activeSessionKey, setActiveSessionKey] = useState(() => {
    try { return localStorage.getItem('escritorio::active_session_key') || null; }
    catch { return null; }
  });

  // Mounted terminal sessions (each entry = a live TerminalPanel in the DOM)
  // NOT restored from localStorage on boot — only explicitly started sessions live here
  const [sessions, setSessions] = useState([]);

  // Server-side activity data (from /api/sessions/active) — live PTYs only
  const [activeSessions, setActiveSessions] = useState({});

  // Fase 4 (ADR-01): TODAS as sessões persistidas em sessions.db (from
  // /api/sessions/persisted) — a fonte de verdade da lista "Chats Abertos".
  // Diferente de activeSessions: sobrevive a reload, a dias, e a PTYs que já
  // morreram (grace period ou restart do backend); só sai daqui quando o
  // usuário encerra explicitamente (terminateSession -> store.clear()).
  const [persistedSessions, setPersistedSessions] = useState({});

  // Which project's tab strip / start-chat buttons are shown in the main panel.
  // Independent from activeSessionKey so a project with no started session yet
  // can still be "selected" (see header comment).
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try {
      const storedProject = localStorage.getItem('escritorio::selected_project_id');
      if (storedProject) return storedProject;
      const storedKey = localStorage.getItem('escritorio::active_session_key');
      return storedKey ? storedKey.split('::')[0] : null;
    } catch { return null; }
  });

  // Grace window: session keys that were just started and should not be evicted by poll
  const justStartedRef = useRef(new Map()); // key → timestamp

  // Fase 4 (D-04): ref-mirror of activeSessionKey so the poll tick() (which
  // intentionally has an empty deps array — see the poll effect below) can
  // read the CURRENT focused key without a stale closure, without restarting
  // the 7s interval on every selection change.
  const activeSessionKeyRef = useRef(activeSessionKey);
  useEffect(() => { activeSessionKeyRef.current = activeSessionKey; }, [activeSessionKey]);

  // Snapshot of activeSessionKey taken at the provider's FIRST render only (page
  // load/reload). Intentionally never reassigned afterward — this is what scopes
  // the auto-remount effect below to page-load recovery only (D-13, reverts CR-01).
  const initialSessionKeyRef = useRef(activeSessionKey);

  // ─── Channel A of the end-of-chat notification (sound + Web Notification) ───
  // Everything in refs, never in state: these values are read INSIDE the
  // poll tick (which runs with deps `[]` on purpose, see the effect further
  // below), and keeping them in state would recreate the 7s interval on
  // every change.
  const notifierRef = useRef(null);
  if (notifierRef.current === null) {
    notifierRef.current = notifier || createBrowserNotifier();
  }
  // Settings from /api/settings/notifications. null = hasn't loaded yet —
  // isQuietNow treats it as "no quiet-hours window" (fail-open).
  const notificationSettingsRef = useRef(null);
  // Keys that have ALREADY notified. null = there's no baseline yet: the
  // first tick only records the state, without firing anything (otherwise
  // opening the page in the morning would play a sound for every chat that
  // finished overnight).
  const notifiedKeysRef = useRef(null);

  // Unlocks audio and requests notification permission on the user's FIRST
  // gesture — both require a gesture per browser policy (on iPad WebKit,
  // requesting permission on page load is silently rejected).
  useEffect(() => installUnlockOnFirstGesture(notifierRef.current), []);

  // Loads the settings once and re-listens for the event emitted by the
  // Settings screen on save — redoing the GET on every 7s tick would be a
  // third request per cycle for data that rarely changes.
  useEffect(() => {
    let cancelled = false;
    api.fetchNotificationSettings()
      .then((data) => { if (!cancelled) notificationSettingsRef.current = data; })
      .catch(() => { /* proceeds without a quiet-hours window — never blocks the sound over a network failure */ });
    const handler = (event) => {
      if (event.detail) notificationSettingsRef.current = event.detail;
    };
    window.addEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handler);
    };
  }, []);

  // Persist selection across page reloads
  useEffect(() => {
    if (activeSessionKey) {
      localStorage.setItem('escritorio::active_session_key', activeSessionKey);
    } else {
      localStorage.removeItem('escritorio::active_session_key');
    }
  }, [activeSessionKey]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem('escritorio::selected_project_id', selectedProjectId);
    } else {
      localStorage.removeItem('escritorio::selected_project_id');
    }
  }, [selectedProjectId]);

  // Fase 4 (D-07): título da aba do navegador é a superfície de notificação
  // que continua funcionando com a sidebar colapsada ou noutra aba do
  // navegador. Usa persistedSessions (não activeSessions) — needs_attention
  // deve contar mesmo para chats sem PTY vivo agora, mesma fonte de verdade
  // do badge do toggle na Sidebar, então os dois números nunca divergem.
  useEffect(() => {
    const count = Object.values(persistedSessions).filter((s) => s.needs_attention).length;
    document.title = count > 0 ? `(${count}) TaskNexus` : 'TaskNexus';
  }, [persistedSessions]);

  // ─── Core actions ────────────────────────────────────────────────────────────

  /** Selection only — never spawns a PTY. Shows StartChatCTA on the main panel. */
  const selectAgent = useCallback((projectId, agentId) => {
    const key = `${projectId}::${agentId || 'default'}`;
    setActiveSessionKey(key);
  }, []);

  /** Sidebar row click — selects a project without picking (or spawning) any
   * specific agent session. Keeps the current tab if it already belongs to
   * this project; otherwise falls back to any other mounted tab of this
   * project; otherwise clears to null (renders the per-agent start buttons). */
  const selectProject = useCallback((projectId) => {
    setSelectedProjectId(projectId);
    setActiveSessionKey((prevActive) => {
      if (prevActive && prevActive.split('::')[0] === projectId &&
          sessions.some((s) => s.sessionKey === prevActive)) {
        return prevActive;
      }
      const existing = sessions.find((s) => s.projectId === projectId);
      return existing ? existing.sessionKey : null;
    });
  }, [sessions]);

  /** Fase 4 (D-04): clears needs_attention optimistically (before the API
   * round-trip resolves) and tolerates failure — the next 7s poll re-sets it
   * if the ack didn't actually persist server-side, same resilience pattern
   * as terminateSession below. */
  const ackSession = useCallback(async (key) => {
    if (!key) return;
    // Atualiza os dois dicts no mesmo instante — persistedSessions alimenta o
    // contador do toggle/título, activeSessions alimenta a cor do dot; UI-SPEC
    // exige que nunca mostrem números diferentes entre si.
    setActiveSessions((prev) => {
      if (!prev[key]?.needs_attention) return prev;
      return { ...prev, [key]: { ...prev[key], needs_attention: false } };
    });
    setPersistedSessions((prev) => {
      if (!prev[key]?.needs_attention) return prev;
      return { ...prev, [key]: { ...prev[key], needs_attention: false } };
    });
    try { await api.ackSession(key); }
    catch (e) { console.warn('ackSession API error (will resync on next poll)', e); }
  }, []);

  /** Fase 4 (D-08): renomeia otimisticamente em persistedSessions (única fonte
   * de display_name, lida por ambas as superfícies via tabLabels) e reverte
   * para o nome anterior se a API falhar — mesmo padrão de tolerância a falha
   * de ackSession/terminateSession acima. */
  const renameSession = useCallback(async (key, displayName) => {
    let previous;
    setPersistedSessions((prev) => {
      previous = prev[key]?.display_name;
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], display_name: displayName } };
    });
    try {
      await api.renameSession(key, displayName);
    } catch (e) {
      console.warn('rename failed, reverting', e);
      setPersistedSessions((prev) => {
        if (!prev[key]) return prev;
        return { ...prev, [key]: { ...prev[key], display_name: previous } };
      });
    }
  }, []);

  /** Explicit mount — mounts a TerminalPanel which opens the WS and spawns PTY. */
  const startSession = useCallback((key, projectId, agentId) => {
    setSessions((prev) => {
      if (prev.some((s) => s.sessionKey === key)) return prev;
      return [...prev, { sessionKey: key, projectId, agentId }];
    });
    setActiveSessionKey(key);
    // Register grace window so next poll tick doesn't evict it before server confirms
    justStartedRef.current.set(key, Date.now());
    // Fase 4 (UI-SPEC section 3): switching to a chat must clear its pending
    // notification immediately, not wait up to 7s for the next poll. Checks
    // persistedSessions too — a chat can have needs_attention=true with no
    // live PTY (activeSessions wouldn't even have an entry for it).
    if (activeSessions[key]?.needs_attention || persistedSessions[key]?.needs_attention) {
      ackSession(key);
    }
  }, [activeSessions, persistedSessions, ackSession]);

  // Bugfix round (2026-07-06, Bug 1): "latest ref" mirror of startSession so the
  // auto-remount effect below can call the CURRENT startSession without listing
  // it as a dependency. startSession is itself recreated whenever activeSessions/
  // persistedSessions change (see its useCallback deps above) — with
  // `[startSession]` as the effect's deps, ANY unrelated activity-poll update to
  // those dicts re-ran the whole auto-remount effect, which is only supposed to
  // run once at provider mount. Mutating a ref during render (not inside a
  // useEffect) is the standard "latest ref" pattern for this exact situation.
  const startSessionRef = useRef(startSession);
  startSessionRef.current = startSession;

  /** "Iniciar chat {agente}" — reuses the bare projectId::agentId key if it
   * isn't already an open tab (reconnects an unmounted-but-alive server
   * session exactly like before); otherwise appends a random suffix so a
   * second/third simultaneous chat of the same agent gets its own PTY. */
  const startNewInstance = useCallback((projectId, agentId) => {
    const bareKey = `${projectId}::${agentId}`;
    const bareTaken = sessions.some((s) => s.sessionKey === bareKey);
    const key = bareTaken
      ? `${bareKey}::${Math.random().toString(36).slice(2, 8)}`
      : bareKey;
    setSelectedProjectId(projectId);
    startSession(key, projectId, agentId);
    return key;
  }, [sessions, startSession]);

  /** Terminate server-side, then remove local terminal mount. If the closed
   * tab was active, switch to a sibling tab of the same project if one
   * exists; otherwise clear to null (shows the start buttons again). */
  const terminateSession = useCallback(async (key) => {
    try { await api.terminateSession(key); }
    catch (e) { console.warn('terminateSession API error (continuing with local unmount)', e); }
    const terminated = sessions.find((s) => s.sessionKey === key);
    const remaining = sessions.filter((s) => s.sessionKey !== key);
    setSessions(remaining);
    justStartedRef.current.delete(key);
    // Fase 4 (D-02): sai da lista "Chats Abertos" imediatamente — não espera o
    // próximo poll de 7s confirmar que o backend limpou a linha no SQLite.
    setPersistedSessions((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    if (activeSessionKey === key) {
      const sibling = terminated ? remaining.find((s) => s.projectId === terminated.projectId) : null;
      setActiveSessionKey(sibling ? sibling.sessionKey : null);
    }
  }, [sessions, activeSessionKey]);

  // ─── Poll: activity data + mount reconciliation ───────────────────────────

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      let data = {};
      try {
        data = await api.fetchActiveSessions();
        if (!cancelled) setActiveSessions(data);
      } catch {
        // Network blip — keep last known state
        return;
      }
      if (cancelled) return;

      // Fase 4 (ADR-01): fonte de verdade da lista "Chats Abertos" — não
      // bloqueia o resto do tick nem desfaz o que já foi lido acima se falhar.
      let persisted = null;
      try {
        persisted = await api.fetchPersistedSessions();
        if (!cancelled) setPersistedSessions(persisted);
      } catch {
        // Network blip — keep last known state
      }

      // Fase 4 (UI-SPEC section 3, BDD "chat focado não notifica a si mesmo"):
      // if the currently-focused session comes back from this poll with a
      // pending notification, ack it right away — the user is already looking
      // at it, it should never visibly light up.
      const focusedKey = activeSessionKeyRef.current;
      if (focusedKey && data[focusedKey]?.needs_attention) {
        ackSession(focusedKey);
      }

      // Channel A: sound + Web Notification for chats that JUST became
      // pending. Uses persistedSessions (same source as the badge/title),
      // and only when this round's fetch succeeded — deciding off an empty
      // map from a network failure would reset the baseline and make
      // everything notify again on the next tick. The decision itself is
      // the pure function decideSessionsToNotify (TRANSITION detection:
      // without it, the sound would repeat every 7s while needs_attention
      // stayed true).
      if (persisted && !cancelled) {
        const { toNotify, nextNotifiedKeys } = decideSessionsToNotify({
          sessions: persisted,
          notifiedKeys: notifiedKeysRef.current,
          focusedKey,
          quietHoursActive: isQuietNow(notificationSettingsRef.current),
        });
        notifiedKeysRef.current = nextNotifiedKeys;
        if (toNotify.length > 0) {
          // A single sound, even when several chats finished in the same
          // tick — the visual notification is per session (tag =
          // session_key), the sound doesn't need to (and shouldn't) stack.
          notifierRef.current.playSound();
          for (const key of toNotify) {
            notifierRef.current.notify(buildSessionNotification(key, persisted[key]));
          }
        }
      }

      // Reconciliation: unmount terminals whose PTY no longer exists on the server,
      // unless they are within the just-started grace window.
      setSessions((prev) => {
        const now = Date.now();
        return prev.filter((s) => {
          if (data[s.sessionKey]) return true; // server still has it
          const startedAt = justStartedRef.current.get(s.sessionKey);
          if (startedAt && now - startedAt < JUST_STARTED_GRACE_MS) return true; // grace
          justStartedRef.current.delete(s.sessionKey);
          return false;
        });
      });
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []); // poll runs once; reconciliation uses functional setSessions so no stale state

  // ─── Auto-remount: fires EXACTLY ONCE, at provider mount, for whichever
  // session key was already restored from localStorage at that moment (i.e. a
  // page load or full reload) — never again afterward. It must NEVER re-fire
  // for a later selectAgent call, even when the newly-selected agent's PTY is
  // confirmed alive server-side: that always requires an explicit startSession
  // (an "Iniciar chat" button click). See .planning/debug/auto-spawn-on-select.md.
  // This REVERTS the CR-01 fix (03-REVIEW-FIX.md), which re-ran this effect on
  // every activeSessionKey change to serve reload-recovery for non-initial
  // selections — but that reopened a D-07 violation (silent reattach-on-select).
  // D-13 (03-CONTEXT.md) resolves the conflict in D-07's favor.
  //
  // Bugfix round (2026-07-06, Bug 1): deps is now `[]` — the "runs exactly
  // once" guarantee is structural (empty dep array), not merely incidental to
  // startSession's reference happening to stay stable. Previously deps was
  // `[startSession]`; since startSession is recreated whenever activeSessions/
  // persistedSessions change (its own useCallback deps), any activity-poll
  // update to those dicts re-ran this effect and could re-fire the auto-remount
  // for the SAME initial key on every such change. It calls startSessionRef.current(...)
  // instead of startSession(...) directly so it still always invokes the latest
  // version of that callback despite the empty deps array.
  useEffect(() => {
    const key = initialSessionKeyRef.current;
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchActiveSessions();
        if (cancelled) return;
        setActiveSessions(data);
        let shouldRestore = Boolean(data[key]);
        // Mobile fix: a backgrounded (non-PWA) browser tab can get fully
        // discarded and reloaded from scratch after the phone was locked long
        // enough — by then the PTY may already be gone (CLEANUP_DELAY grace
        // period expired) even though the conversation itself is still there
        // in sessions.db. Without this fallback the reload silently drops the
        // user on StartChatCTA instead of reconnecting, which reads as "the
        // session ended" even though reopening the same chat from "Chats
        // Abertos" would have resumed it fine via --resume (same recovery
        // path /api/sessions/persisted already documents for that flow).
        if (!shouldRestore) {
          try {
            const persisted = await api.fetchPersistedSessions();
            if (cancelled) return;
            setPersistedSessions(persisted);
            shouldRestore = Boolean(persisted[key]);
          } catch { /* server unreachable — user will see StartChatCTA */ }
        }
        if (shouldRestore) {
          const [projectId, agentId] = key.split('::');
          startSessionRef.current(key, projectId, agentId);
        }
      } catch { /* server unreachable — user will see StartChatCTA */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <TerminalContext.Provider value={{
      sessions,
      activeSessionKey,
      selectedProjectId,
      selectAgent,
      selectProject,
      startSession,
      startNewInstance,
      terminateSession,
      ackSession,
      renameSession,
      activeSessions,
      persistedSessions,
      // Legacy compat shim — routes old openSession calls to selectAgent
      openSession: selectAgent,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) throw new Error('useTerminal must be used within a TerminalProvider');
  return context;
}
