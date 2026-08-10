// frontend/src/components/TaskDetailModal.jsx
// Full-screen task modal (Designer decision 5) — covers the whole viewport,
// including the sidebar, so it's rendered as position:fixed regardless of
// where it's mounted in the tree (TasksDrawer renders it as a child; fixed
// positioning still escapes the drawer's own stacking box since no ancestor
// in this app sets `transform`/`filter`, which would otherwise create a
// containing block).
//
// Two modes:
// - View mode (`task` provided): renders descricao_markdown (marked + DOMPurify
//   sanitize, decision 7) and, if descricao_html is present, a Markdown /
//   Visualização segmented control (decision 6) whose "Visualização" pill
//   renders descricao_html inside a sandboxed iframe with NO allow-* tokens
//   (decision 7 — isolation by construction, not just string sanitization).
// - Create mode (`task` is null): título input + markdown textarea only, no
//   manual HTML field (decision 9 — impractical to paste HTML on an iPad).
//
// "Continuar" is deliberately NOT rendered here — Designer decision 9 places
// it in the drawer footer as a session-level action, not a per-task one.
// (Decision 5 also mentions a modal footer "Continuar" button; decision 9 is
// the more specific/explicit one and supersedes it — see DEV delivery notes.)

import { useState } from 'react';
import { renderMarkdown } from '../utils/markdown.js';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'var(--bg-surface)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  closeBtn: {
    width: 'var(--touch-target)',
    height: 'var(--touch-target)',
    minWidth: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  title: {
    flex: 1,
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  completeBtn: (done) => ({
    flexShrink: 0,
    padding: '8px 14px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: done ? 'var(--accent-green-dim)' : 'transparent',
    color: done ? 'var(--accent-green)' : 'var(--text-primary)',
    fontSize: '13px',
    cursor: done ? 'default' : 'pointer',
  }),
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  segmented: {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    marginBottom: '16px',
    background: 'var(--bg-surface-2)',
    borderRadius: 'var(--radius-sm)',
    width: 'fit-content',
  },
  segmentBtn: (active) => ({
    padding: '6px 14px',
    minHeight: '32px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '13px',
    cursor: 'pointer',
  }),
  markdownBody: {
    color: 'var(--text-primary)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  htmlCard: {
    background: 'var(--bg-surface-2)',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
  },
  iframe: {
    width: '100%',
    height: 'calc(100vh - 220px)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: '#ffffff',
    display: 'block',
  },
  formField: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: '240px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '12px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  submitBtn: {
    padding: '10px 18px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export function TaskDetailModal({ task, onClose, onComplete, onCreate }) {
  const isCreate = !task;
  const [tab, setTab] = useState('markdown'); // 'markdown' | 'html'
  const [titulo, setTitulo] = useState('');
  const [descricaoMarkdown, setDescricaoMarkdown] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const trimmedTitulo = titulo.trim();
    if (!trimmedTitulo || saving) return;
    setSaving(true);
    try {
      await onCreate({ titulo: trimmedTitulo, descricao_markdown: descricaoMarkdown, descricao_html: null });
      onClose();
    } catch (e) {
      alert('Falha ao criar tarefa. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <button
          style={styles.closeBtn}
          aria-label="Fechar"
          onClick={onClose}
        >
          ×
        </button>
        <div style={styles.title}>{isCreate ? 'Nova Tarefa' : task.titulo}</div>
        {!isCreate && (
          <button
            style={styles.completeBtn(task.status === 'done')}
            disabled={task.status === 'done'}
            onClick={() => onComplete(task.id)}
          >
            {task.status === 'done' ? 'Concluída' : 'Marcar concluída'}
          </button>
        )}
      </div>

      <div style={styles.body}>
        {isCreate ? (
          <>
            <div style={styles.formField}>
              <label style={styles.label} htmlFor="task-titulo">Título</label>
              <input
                id="task-titulo"
                style={styles.input}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título da tarefa"
                autoFocus
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label} htmlFor="task-markdown">Descrição (Markdown)</label>
              <textarea
                id="task-markdown"
                style={styles.textarea}
                value={descricaoMarkdown}
                onChange={(e) => setDescricaoMarkdown(e.target.value)}
                placeholder="Descreva a tarefa em markdown..."
              />
            </div>
          </>
        ) : (
          <>
            {task.descricao_html != null && (
              <div style={styles.segmented}>
                <button
                  style={styles.segmentBtn(tab === 'markdown')}
                  onClick={() => setTab('markdown')}
                >
                  Markdown
                </button>
                <button
                  style={styles.segmentBtn(tab === 'html')}
                  onClick={() => setTab('html')}
                >
                  Visualização
                </button>
              </div>
            )}
            {tab === 'markdown' || task.descricao_html == null ? (
              <div
                style={styles.markdownBody}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(task.descricao_markdown) }}
              />
            ) : (
              <div style={styles.htmlCard}>
                <iframe
                  title={`Visualização — ${task.titulo}`}
                  sandbox=""
                  srcDoc={task.descricao_html}
                  style={styles.iframe}
                />
              </div>
            )}
          </>
        )}
      </div>

      {isCreate && (
        <div style={styles.footer}>
          <button
            style={{ ...styles.submitBtn, opacity: saving || !titulo.trim() ? 0.6 : 1 }}
            disabled={saving || !titulo.trim()}
            onClick={handleSubmit}
          >
            {saving ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      )}
    </div>
  );
}
