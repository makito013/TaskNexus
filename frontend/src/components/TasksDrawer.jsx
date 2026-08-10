// frontend/src/components/TasksDrawer.jsx
// Right-side overlay drawer for the active session's tasks (Designer decision
// 1). Slides over TerminalPanel (which stays mounted underneath — this is an
// overlay, not a replacement). Opens/closes via SessionTabs' "📋 Tarefas"
// button or a tap on the backdrop.
//
// Owns the detail/create modal's open/closed local state — the modal itself
// (TaskDetailModal) is rendered as position:fixed so it covers the full
// viewport including the sidebar (decision 5) regardless of being nested here.

import { useEffect, useState } from 'react';
import { NARROW_VIEWPORT_QUERY } from '../utils/viewport.js';
import { TaskDetailModal } from './TaskDetailModal.jsx';

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(NARROW_VIEWPORT_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const handler = (e) => setNarrow(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler); // older Safari
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);
  return narrow;
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    zIndex: 400,
  },
  drawer: (narrow) => ({
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: narrow ? '90vw' : '400px',
    maxWidth: '420px',
    background: 'var(--bg-surface)',
    borderLeft: '1px solid var(--border-strong)',
    zIndex: 401,
    display: 'flex',
    flexDirection: 'column',
  }),
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  closeBtn: {
    width: 'var(--touch-target)',
    height: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '6px 16px',
    cursor: 'pointer',
  },
  // 28px: reduced from the --touch-target (44px) token per Bruno's real-iPad
  // test — the 44px circle read as visually oversized. Not reverting to the
  // Designer's original 44px spec; touch-target compliance for this specific
  // control is a deliberate, validated trade-off (see DEV report). The
  // surrounding `item` row (padding + two-line title clamp) is taller than
  // 28px on its own, so the effective tap area isn't as small as the circle
  // alone suggests.
  circle: (done) => ({
    width: '28px',
    height: '28px',
    minWidth: '28px',
    borderRadius: '50%',
    border: `2px solid ${done ? 'var(--accent-green)' : 'var(--border-strong)'}`,
    background: done ? 'var(--accent-green-dim)' : 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  }),
  itemTitle: (done) => ({
    flex: 1,
    fontSize: '14px',
    color: done ? 'var(--text-muted)' : 'var(--text-primary)',
    textDecoration: done ? 'line-through' : 'none',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }),
  sectionToggle: {
    width: '100%',
    textAlign: 'left',
    padding: '10px 16px',
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  emptyState: {
    margin: 'auto',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px',
    padding: '0 24px',
  },
  emptyStateBtn: {
    marginTop: '12px',
    padding: '10px 16px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px dashed var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    // flex-end (not center): continueWrap is now a taller column ("N
    // pendente(s)" text + gap + Continuar button) than the single-line
    // "+ Nova Tarefa" button. Aligning to the end keeps both buttons'
    // bottoms flush instead of centering newTaskBtn against the taller
    // column and leaving mismatched top/bottom whitespace.
    alignItems: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  newTaskBtn: {
    flex: 1,
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px dashed var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  continueWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
  },
  continueBtn: {
    padding: '10px 16px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  pendingHint: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
};

export function TasksDrawer({ open, sessionKey, tasks, onClose, onCreateTask, onCompleteTask, onUncompleteTask, onContinue }) {
  const narrow = useNarrowViewport();
  const [showCompleted, setShowCompleted] = useState(false);
  // null | 'new' | taskId — storing the id (not a task snapshot) means the
  // modal always renders the LATEST data for that task from `tasks` (e.g. if
  // a poll tick updates it while open), instead of a stale click-time copy.
  const [modalTarget, setModalTarget] = useState(null);

  // Reset transient UI state whenever the drawer closes or the underlying
  // session changes, so reopening never shows a stale modal/expanded section.
  useEffect(() => {
    if (!open) {
      setModalTarget(null);
      setShowCompleted(false);
    }
  }, [open, sessionKey]);

  if (!open) return null;

  const pending = tasks.filter((t) => t.status !== 'done');
  const completed = tasks.filter((t) => t.status === 'done');
  const modalTask = modalTarget && modalTarget !== 'new'
    ? tasks.find((t) => t.id === modalTarget) || null
    : null;

  const handleComplete = (taskId) => onCompleteTask(sessionKey, taskId);
  const handleUncomplete = (taskId) => onUncompleteTask(sessionKey, taskId);
  const handleCreate = (payload) => onCreateTask(sessionKey, payload);

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.drawer(narrow)}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Tarefas</span>
          <button style={styles.closeBtn} aria-label="Fechar tarefas" onClick={onClose}>×</button>
        </div>

        {tasks.length === 0 ? (
          <div style={{ flex: 1, display: 'flex' }}>
            <div style={styles.emptyState}>
              Nenhuma tarefa nesta sessão
              <div>
                <button style={styles.emptyStateBtn} onClick={() => setModalTarget('new')}>+ Nova Tarefa</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.list}>
            {pending.map((t) => (
              <div key={t.id} style={styles.item}>
                <button
                  style={styles.circle(false)}
                  aria-label={`Marcar "${t.titulo}" como concluída`}
                  onClick={(e) => { e.stopPropagation(); handleComplete(t.id); }}
                />
                <div style={styles.itemTitle(false)} onClick={() => setModalTarget(t.id)}>{t.titulo}</div>
              </div>
            ))}

            {completed.length > 0 && (
              <>
                <button style={styles.sectionToggle} onClick={() => setShowCompleted((v) => !v)}>
                  {showCompleted ? '▾' : '▸'} Concluídas ({completed.length})
                </button>
                {showCompleted && completed.map((t) => (
                  <div key={t.id} style={styles.item}>
                    <button
                      style={styles.circle(true)}
                      aria-label={`Reabrir "${t.titulo}" (marcar como pendente)`}
                      onClick={(e) => { e.stopPropagation(); handleUncomplete(t.id); }}
                    />
                    <div style={styles.itemTitle(true)} onClick={() => setModalTarget(t.id)}>{t.titulo}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.newTaskBtn} onClick={() => setModalTarget('new')}>+ Nova Tarefa</button>
          <div style={styles.continueWrap}>
            <span style={styles.pendingHint}>{pending.length} pendente{pending.length === 1 ? '' : 's'}</span>
            <button style={styles.continueBtn} onClick={() => onContinue(sessionKey)}>Continuar</button>
          </div>
        </div>
      </div>

      {modalTarget && (
        <TaskDetailModal
          task={modalTarget === 'new' ? null : modalTask}
          onClose={() => setModalTarget(null)}
          onComplete={(taskId) => { handleComplete(taskId); setModalTarget(null); }}
          onCreate={handleCreate}
        />
      )}
    </>
  );
}
