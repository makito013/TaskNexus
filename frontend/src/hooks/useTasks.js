// frontend/src/hooks/useTasks.js
// Task drawer state — owned above SessionTabs AND TasksDrawer so both can read
// pending counts (SessionTabs' per-tab badges) from the same source of truth.
//
// Key design decisions (Fase "Tarefas", plano TL itens 12-17):
// - Polling only runs while the drawer is open (Designer decision 10) — the
//   effect below is gated on `drawerOpen` and re-targets `sessionKey` if the
//   active tab changes while the drawer stays open.
// - tasksBySession persists per session key even after the drawer closes, so
//   a tab's pending-count badge keeps showing the last known count instead of
//   disappearing — it only refreshes the next time that session's drawer (or
//   poll) runs. Sessions never opened in the drawer simply have no entry, so
//   their tab renders no badge (never a stale "0").
// - completeTask applies an optimistic update immediately (Designer decision
//   8) and reverts on failure. The optimisticDoneIds ref guards against a
//   poll response landing mid-flight and clobbering the optimistic "done"
//   back to "pending" — completion is monotonic, so merge always prefers a
//   locally-confirmed "done" over a fresher-but-stale "pending" from the
//   server (mirrors the ack/rename optimistic pattern in TerminalContext.jsx).
// - Interval: 5000ms — within the 3-5s range suggested by the plan, same
//   order of magnitude as the existing 7000ms activeSessions poll
//   (TerminalContext.jsx POLL_INTERVAL_MS).

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api.js';

const TASKS_POLL_INTERVAL_MS = 5000;

export function useTasks(activeSessionKey) {
  const [tasksBySession, setTasksBySession] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  // "Latest ref" mirror of tasksBySession so completeTask (below) can read the
  // CURRENT list synchronously to look up the task being completed, without
  // depending on React's setState-updater being invoked eagerly/synchronously
  // (an internal implementation detail that isn't guaranteed) — same pattern
  // as activeSessionKeyRef in TerminalContext.jsx.
  const tasksBySessionRef = useRef(tasksBySession);
  useEffect(() => { tasksBySessionRef.current = tasksBySession; }, [tasksBySession]);

  // "sessionKey::taskId" composite keys we've optimistically marked done
  // locally but haven't necessarily seen echoed back by the server yet — see
  // header comment. Task ids ARE globally unique (single `tasks` table,
  // INTEGER PRIMARY KEY AUTOINCREMENT — backend/app/task_store.py), but the
  // set is scoped by session anyway as cheap defense-in-depth: it removes the
  // dependency on that backend detail staying true.
  const optimisticDoneIds = useRef(new Set());
  const optimisticKey = (sessionKey, taskId) => `${sessionKey}::${taskId}`;

  const mergeTasks = useCallback((sessionKey, freshList) => {
    setTasksBySession((prev) => {
      const merged = freshList.map((t) => {
        if (optimisticDoneIds.current.has(optimisticKey(sessionKey, t.id)) && t.status !== 'done') {
          const prevTask = (prev[sessionKey] || []).find((p) => p.id === t.id);
          return { ...t, status: 'done', completed_at: t.completed_at || prevTask?.completed_at || new Date().toISOString() };
        }
        return t;
      });
      return { ...prev, [sessionKey]: merged };
    });
  }, []);

  const fetchTasksFor = useCallback(async (sessionKey) => {
    if (!sessionKey) return;
    try {
      const list = await api.fetchTasks(sessionKey);
      mergeTasks(sessionKey, list);
    } catch (e) {
      // Network blip — keep last known state, same tolerance as the
      // activeSessions poll in TerminalContext.jsx.
      console.warn('fetchTasks error (keeping last known state)', e);
    }
  }, [mergeTasks]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Guard: if the active session disappears (e.g. the user terminates the
  // last open tab) while the drawer is open, close it — otherwise it would
  // keep showing a drawer for `sessionKey: null` and "+ Nova Tarefa"/
  // "Continuar" would try to hit /api/sessions/null/...
  useEffect(() => {
    if (!activeSessionKey) setDrawerOpen(false);
  }, [activeSessionKey]);

  // Poll: only while the drawer is open, only for the current active session.
  useEffect(() => {
    if (!drawerOpen || !activeSessionKey) return undefined;
    let cancelled = false;
    const tick = () => { if (!cancelled) fetchTasksFor(activeSessionKey); };
    tick();
    const interval = setInterval(tick, TASKS_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [drawerOpen, activeSessionKey, fetchTasksFor]);

  const createTask = useCallback(async (sessionKey, payload) => {
    const created = await api.createTask(sessionKey, payload);
    setTasksBySession((prev) => ({
      ...prev,
      [sessionKey]: [...(prev[sessionKey] || []), created],
    }));
    return created;
  }, []);

  const completeTask = useCallback(async (sessionKey, taskId) => {
    const previousTask = (tasksBySessionRef.current[sessionKey] || []).find((t) => t.id === taskId);
    if (!previousTask) return; // unknown task id — nothing to optimistically flip or revert

    optimisticDoneIds.current.add(optimisticKey(sessionKey, taskId));
    setTasksBySession((prev) => {
      const list = prev[sessionKey] || [];
      const updated = list.map((t) => (t.id === taskId
        ? { ...t, status: 'done', completed_at: t.completed_at || new Date().toISOString() }
        : t));
      return { ...prev, [sessionKey]: updated };
    });
    try {
      await api.completeTask(sessionKey, taskId);
    } catch (e) {
      optimisticDoneIds.current.delete(optimisticKey(sessionKey, taskId));
      setTasksBySession((prev) => {
        const list = prev[sessionKey] || [];
        const reverted = list.map((t) => (t.id === taskId ? previousTask : t));
        return { ...prev, [sessionKey]: reverted };
      });
      alert('Falha ao concluir tarefa. Tente novamente.');
    }
  }, []);

  // Symmetric to completeTask: optimistically flips a DONE task back to
  // pending (e.g. user tapped the "done" circle by mistake). Same
  // optimistic-then-revert-on-failure shape as completeTask, but here the
  // SUCCESS path also has to clean up optimisticDoneIds — otherwise a poll
  // response that still (correctly, now) shows the task as done because of
  // a stale/in-flight optimistic "done" entry could clobber this pending
  // state back to done via the mergeTasks guard above.
  const uncompleteTask = useCallback(async (sessionKey, taskId) => {
    const previousTask = (tasksBySessionRef.current[sessionKey] || []).find((t) => t.id === taskId);
    if (!previousTask) return; // unknown task id — nothing to optimistically flip or revert

    setTasksBySession((prev) => {
      const list = prev[sessionKey] || [];
      const updated = list.map((t) => (t.id === taskId
        ? { ...t, status: 'pending', completed_at: null }
        : t));
      return { ...prev, [sessionKey]: updated };
    });
    try {
      await api.reopenTask(sessionKey, taskId);
      // Success: the task is genuinely pending now server-side too, so the
      // optimistic-done marker (if any, from an earlier completeTask) no
      // longer applies — remove it so a concurrent poll can't re-flip this
      // back to done via the mergeTasks guard.
      optimisticDoneIds.current.delete(optimisticKey(sessionKey, taskId));
    } catch (e) {
      setTasksBySession((prev) => {
        const list = prev[sessionKey] || [];
        const reverted = list.map((t) => (t.id === taskId ? previousTask : t));
        return { ...prev, [sessionKey]: reverted };
      });
      alert('Falha ao reabrir tarefa. Tente novamente.');
    }
  }, []);

  const continueSession = useCallback(async (sessionKey) => {
    try {
      await api.continueSession(sessionKey);
    } catch (e) {
      // Contrato do backend nunca retorna erro para este endpoint — se ainda
      // assim falhar (rede fora do ar, etc.), avisa sem travar a UI.
      console.warn('continueSession API error', e);
      alert('Falha ao enviar "continuar". Verifique a conexão e tente novamente.');
    }
  }, []);

  const pendingCounts = useMemo(() => {
    const counts = {};
    for (const [key, list] of Object.entries(tasksBySession)) {
      counts[key] = list.filter((t) => t.status !== 'done').length;
    }
    return counts;
  }, [tasksBySession]);

  return {
    tasksBySession,
    pendingCounts,
    drawerOpen,
    openDrawer,
    closeDrawer,
    createTask,
    completeTask,
    uncompleteTask,
    continueSession,
  };
}
