// frontend/src/layouts/v2/TaskDetailModalV2.jsx
// Task detail modal for Tarefas v2 — read + complete/reopen only (edit/delete
// are separate cards, out of scope here). v2-native visual, unlike the v1
// `TaskDetailModal.jsx` (fullscreen, `--bg-surface` tokens, no light/dark),
// which this component does NOT reuse or touch.
//
// Same "diálogo responsivo v2" pattern as `NewChatSheet`/the board column
// dialogs (`BoardColumnRenameDialog`/`BoardColumnDeleteDialog`, commit
// ad9a073): the component reads its own breakpoint via
// `useMediaQuery(MOBILE_VIEWPORT_QUERY)` and picks `BottomSheet` (mobile) or
// `CenteredModal` (desktop). `CardFormModal.jsx` is NOT an instance of this
// pattern — it stays centered at every width and never renders
// `BottomSheet` — so it is not the model followed here.
//
// The parent (`TarefasV2.jsx`) only mounts this component when a task is
// selected (`task` is never null) and remounts it via `key={task.id}` when
// the selection changes — that's what resets the local `tab` state below
// without this component reading anything about "am I a new task".
//
// Markdown -> safe HTML goes through the shared `renderMarkdown` (marked +
// DOMPurify, utils/markdown.js) unchanged; the optional HTML preview is
// rendered in a `sandbox=""` iframe with no `allow-*` tokens, same isolation
// approach as the v1 modal this was split off from — the JSX is replicated
// (not shared) because it's ~8 lines and there is no third consumer yet.

import { useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { formatDateTime } from '../../utils/cardMeta.js';
import { renderMarkdown } from '../../utils/markdown.js';
import { MOBILE_VIEWPORT_QUERY } from '../../utils/viewport.js';
import { BottomSheet } from './BottomSheet.jsx';
import { CenteredModal } from './CenteredModal.jsx';
import { resolveCardTags } from './useClienteProjetoFilter.js';

const styles = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  closeBtn: {
    width: '40px',
    height: '40px',
    minWidth: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--v2-text-dim)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toggleBtn: (done) => ({
    flexShrink: 0,
    padding: '0 14px',
    height: '36px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: done ? 'transparent' : 'var(--v2-accent-soft)',
    color: done ? 'var(--v2-text-dim)' : 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  }),
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
  },
  badge: (done) => ({
    display: 'inline-block',
    marginBottom: '14px',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    background: done ? 'var(--v2-accent-soft)' : 'var(--v2-accent-2-soft)',
    color: done ? 'var(--v2-accent-strong)' : 'var(--v2-accent-2)',
  }),
  segmented: {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    marginBottom: '14px',
    background: 'var(--v2-surface-2)',
    borderRadius: '8px',
    width: 'fit-content',
  },
  segmentBtn: (active) => ({
    padding: '6px 14px',
    minHeight: '32px',
    borderRadius: '6px',
    border: 'none',
    background: active ? 'var(--v2-surface)' : 'transparent',
    color: active ? 'var(--v2-text)' : 'var(--v2-text-dim)',
    fontSize: '13px',
    cursor: 'pointer',
  }),
  markdownBody: {
    color: 'var(--v2-text)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  emptyDescription: {
    color: 'var(--v2-text-faint)',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  // Fixed white background, on purpose: the preview shows the task's HTML as
  // its own page, isolated from the rest of the app's light/dark theme —
  // same comment as v1 (TaskDetailModal.jsx), to avoid this being reported
  // as a "bug" in QA.
  iframe: {
    width: '100%',
    // `min(420px, 50vh)`, not `calc(100vh - 220px)` copied from v1: the
    // CenteredModal panel already has `maxHeight: min(600px, calc(100vh -
    // 48px))`, so a height meant for a fullscreen modal would overflow it.
    height: 'min(420px, 50vh)',
    border: 'none',
    borderRadius: '8px',
    background: '#ffffff',
    display: 'block',
  },
  rail: {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid var(--v2-border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  railRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    fontSize: '13px',
  },
  railLabel: {
    color: 'var(--v2-text-faint)',
  },
  railValue: {
    color: 'var(--v2-text)',
    textAlign: 'right',
  },
};

function ModalBody({ task, projects }) {
  const [tab, setTab] = useState('markdown'); // 'markdown' | 'html'
  const hasHtml = task.descricao_html != null;
  // QA gap (report bug #1): `renderMarkdown('')`/`renderMarkdown(null)`
  // resolve to `''`, so without this check the body rendered a bare, empty
  // div. `.trim()` treats a whitespace-only description as empty too, same
  // "nothing to show" outcome as a blank string.
  const hasMarkdown = Boolean(task.descricao_markdown && task.descricao_markdown.trim());
  const hasDescription = hasHtml || hasMarkdown;
  const done = task.status === 'done';
  const { clienteNome, projetoNome } = resolveCardTags(task.projeto_id, projects);

  return (
    <div style={styles.body}>
      <span style={styles.badge(done)}>{done ? 'Concluída' : 'Em aberto'}</span>

      {hasHtml && (
        <div style={styles.segmented}>
          <button
            type="button"
            style={styles.segmentBtn(tab === 'markdown')}
            onClick={() => setTab('markdown')}
          >
            Markdown
          </button>
          <button
            type="button"
            style={styles.segmentBtn(tab === 'html')}
            onClick={() => setTab('html')}
          >
            Visualização
          </button>
        </div>
      )}

      {!hasDescription ? (
        <div style={styles.emptyDescription}>Sem descrição.</div>
      ) : tab === 'markdown' || !hasHtml ? (
        <div
          style={styles.markdownBody}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(task.descricao_markdown) }}
        />
      ) : (
        <iframe
          title={`Visualização — ${task.titulo}`}
          sandbox=""
          srcDoc={task.descricao_html}
          style={styles.iframe}
        />
      )}

      <div style={styles.rail}>
        <div style={styles.railRow}>
          <span style={styles.railLabel}>Criada em</span>
          <span style={styles.railValue}>{formatDateTime(task.created_at) || '—'}</span>
        </div>
        <div style={styles.railRow}>
          <span style={styles.railLabel}>Concluída em</span>
          <span style={styles.railValue}>{formatDateTime(task.completed_at) || '—'}</span>
        </div>
        {clienteNome && (
          <div style={styles.railRow}>
            <span style={styles.railLabel}>Cliente</span>
            <span style={styles.railValue}>{clienteNome}</span>
          </div>
        )}
        {projetoNome && (
          <div style={styles.railRow}>
            <span style={styles.railLabel}>Projeto</span>
            <span style={styles.railValue}>{projetoNome}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskDetailModalV2({ task, projects, onToggle, onClose }) {
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  const done = task.status === 'done';

  const header = (
    <header style={styles.header}>
      <button type="button" style={styles.closeBtn} aria-label="Fechar" onClick={onClose}>
        ×
      </button>
      <span style={styles.headerTitle}>{task.titulo}</span>
      <button
        type="button"
        style={styles.toggleBtn(done)}
        onClick={() => onToggle(task)}
      >
        {done ? 'Reabrir' : 'Marcar concluída'}
      </button>
    </header>
  );

  const body = <ModalBody task={task} projects={projects} />;

  if (!isMobile) {
    // No extra `role`/`aria-label` here: CenteredModal already renders
    // role="dialog" + aria-modal + the accessible name from `ariaLabel`.
    return (
      <CenteredModal open onClose={onClose} ariaLabel={task.titulo}>
        {header}
        {body}
      </CenteredModal>
    );
  }

  return (
    // BottomSheet carries no dialog semantics of its own — this component
    // supplies them in sheet mode, the opposite of the branch above.
    <BottomSheet open onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-label={task.titulo}>
        {header}
        {body}
      </div>
    </BottomSheet>
  );
}
