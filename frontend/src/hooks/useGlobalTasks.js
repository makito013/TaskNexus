// frontend/src/hooks/useGlobalTasks.js
// Global tasks view state — aggregates the SAME `tasks` table as
// useTasks.js, via GET /api/tasks/global (backend already implemented,
// 05-TL.md Tarefa 11), but does NOT share any state with useTasks.js. This
// is a deliberate decision (05-TL.md, Tarefa 27): useTasks.js is scoped to
// ONE session (owned above SessionTabs/TasksDrawer, only fetched/polled
// while that drawer is open); this hook is scoped to the WHOLE tasks table
// across every session/project at once, for TarefasGlobalView (Tarefa 28).
// Same backend table, logically different data sources — no cache sharing,
// no imports from useTasks.js (confirmed: this file imports only React and
// api.js).
//
// This hook intentionally does NOT expose a continueSession/navigation
// helper. TarefasGlobalView (Tarefa 28) calls useTerminal().startSession(...)
// directly, followed by navigate('/') — the TL's "achado #4" is that the
// session must exist before the chat screen mounts looking for it, so that
// ordering is the caller's responsibility, not this hook's. Bundling a
// second "continue" helper in here would just be a second, disconnected way
// to do the same thing without the terminal-context wiring it actually
// needs.

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';

// Same cadence as TASKS_POLL_INTERVAL_MS in useTasks.js — no reason found to
// diverge; keeps both views feeling equally "live".
const GLOBAL_TASKS_POLL_INTERVAL_MS = 5000;

export function useGlobalTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // "Latest ref" mirror of tasks so completeTask/reopenTask (below) can read
  // the CURRENT list synchronously to look up the task being mutated,
  // without depending on React's setState-updater being invoked eagerly —
  // same pattern as tasksBySessionRef in useTasks.js.
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Task ids optimistically flipped to 'done' locally but not necessarily
  // echoed back by the server yet — guards against a poll response landing
  // mid-flight and clobbering the optimistic 'done' back to 'pending' (same
  // race useTasks.js guards against via optimisticDoneIds). Keyed by task id
  // alone, not `sessionKey::id`: ids are already globally unique (single
  // `tasks` table, INTEGER PRIMARY KEY AUTOINCREMENT —
  // backend/app/task_store.py) and this hook has no per-session
  // partitioning of its state to key off of anyway.
  const optimisticDoneIds = useRef(new Set());

  const mergeTasks = useCallback((freshList) => {
    setTasks((prev) => freshList.map((t) => {
      if (optimisticDoneIds.current.has(t.id) && t.status !== 'done') {
        const prevTask = prev.find((p) => p.id === t.id);
        return { ...t, status: 'done', completed_at: t.completed_at || prevTask?.completed_at || new Date().toISOString() };
      }
      return t;
    }));
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const list = await api.fetchGlobalTasks();
      mergeTasks(list);
    } catch (e) {
      // Network blip — keep last known state, same tolerance as the poll in
      // useTasks.js.
      console.warn('fetchGlobalTasks error (keeping last known state)', e);
    } finally {
      setLoading(false);
    }
  }, [mergeTasks]);

  // Poll continuously while mounted. Unlike useTasks.js (gated on the task
  // drawer being open), there's no separate "closed" state to gate on here:
  // this hook only lives while TarefasGlobalView is mounted, and that view
  // IS the thing displaying the data — it should stay fresh for as long as
  // it's on screen.
  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) fetchAll(); };
    tick();
    const interval = setInterval(tick, GLOBAL_TASKS_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchAll]);

  const completeTask = useCallback(async (sessionKey, taskId) => {
    const previousTask = tasksRef.current.find((t) => t.id === taskId);
    if (!previousTask) return; // unknown task id — nothing to optimistically flip or revert

    optimisticDoneIds.current.add(taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId
      ? { ...t, status: 'done', completed_at: t.completed_at || new Date().toISOString() }
      : t)));
    try {
      await api.completeTask(sessionKey, taskId);
    } catch (e) {
      optimisticDoneIds.current.delete(taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? previousTask : t)));
      alert('Falha ao concluir tarefa. Tente novamente.');
    }
  }, []);

  // Symmetric to completeTask: optimistically flips a done task back to
  // pending. Same optimistic-then-revert-on-failure shape, but the SUCCESS
  // path also clears optimisticDoneIds — otherwise a poll response that
  // still (correctly, now stale) shows the task as done because of a
  // leftover optimistic-done entry could clobber this pending state back to
  // done via the mergeTasks guard above. Mirrors uncompleteTask in
  // useTasks.js.
  const reopenTask = useCallback(async (sessionKey, taskId) => {
    const previousTask = tasksRef.current.find((t) => t.id === taskId);
    if (!previousTask) return; // unknown task id — nothing to optimistically flip or revert

    setTasks((prev) => prev.map((t) => (t.id === taskId
      ? { ...t, status: 'pending', completed_at: null }
      : t)));
    try {
      await api.reopenTask(sessionKey, taskId);
      optimisticDoneIds.current.delete(taskId);
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? previousTask : t)));
      alert('Falha ao reabrir tarefa. Tente novamente.');
    }
  }, []);

  return {
    tasks,
    loading,
    completeTask,
    reopenTask,
  };
}
