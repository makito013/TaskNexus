// frontend/src/components/board/BoardColumnDeleteDialog.jsx
// Column deletion confirmation (task #43, phase 1).
//
// Reuses the visual vocabulary of ClearFinishedModal — the app's other
// destructive confirmation — but with the CURRENT `--v2-*` tokens, not the v1
// `--bg-surface`/`--destructive` ones that component still carries (a known
// debt noted in its own header, not something to propagate into new files).
//
// Most variants are NOT confirmations at all: they explain why the column
// cannot go away and offer no destructive button, because offering one that
// always fails is worse than not offering it. The variant is chosen from the
// backend's machine-readable `reason` (not its prose), so the wording can
// change on either side without breaking the dispatch:
//
//   CONFIRM_REASON      -> the real confirmation, destructive + "Cancelar"
//   'coluna_concluida'  -> informational, only "Entendi"
//   'coluna_com_cards'  -> shows the count, only "Cancelar"
//   anything else       -> generic refusal, only "Cancelar"
//
// The destructive variant is opt-IN, matched against CONFIRM_REASON exactly.
// The earlier shape — destructive unless the reason was one of two known
// refusals — meant any reason this build had not heard of (a newer backend, a
// typo, a proxy rewriting the body) degraded to the DANGEROUS branch and
// offered to delete a column the server had just refused to delete. An
// unrecognised answer is a reason to stop, not to proceed.
//
// The "it is the last column" and "it is the done column" refusals normally
// never reach here at all: BoardColumnMenu disables the menu item up front for
// both. 'coluna_concluida' is still handled because the mark can move in
// another tab between the render and the click.

// The `reason` the caller uses for "the server has not refused anything; ask
// the user to confirm". Deliberately not a backend refusal code.
const CONFIRM_REASON = 'confirm';

import { useEffect } from 'react';

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'var(--v2-scrim)',
    zIndex: 400,
  },
  sheet: {
    position: 'fixed',
    left: '50%',
    bottom: 0,
    transform: 'translateX(-50%)',
    width: '420px',
    maxWidth: '92vw',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderBottom: 'none',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    zIndex: 401,
    overflow: 'hidden',
  },
  title: {
    padding: '16px 16px 8px',
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  body: {
    padding: '0 16px 16px',
    fontSize: '14px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.5,
  },
  strong: { color: 'var(--v2-text)' },
  action: (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '44px',
    width: '100%',
    boxSizing: 'border-box',
    borderTop: '1px solid var(--v2-border)',
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    background: 'transparent',
    fontSize: '14px',
    cursor: disabled ? 'default' : 'pointer',
  }),
  // Same visual pair as CardFormModal's deleteBtn: danger on both the text
  // and the rule above it.
  destructive: { color: 'var(--v2-danger)', borderTopColor: 'var(--v2-danger)' },
  cancel: { color: 'var(--v2-text-dim)', background: 'var(--v2-surface-2)' },
};

export function BoardColumnDeleteDialog({
  open,
  columnLabel,
  reason,
  cards = 0,
  deleting = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !deleting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, deleting, onClose]);

  if (!open) return null;

  const title = `Excluir coluna — ${columnLabel}`;

  // Opt-IN: only the exact confirm reason gets the destructive button. Every
  // other value — known refusal or not — lands on a safe variant.
  const isConfirm = reason === CONFIRM_REASON;

  let body;
  if (isConfirm) {
    body = (
      <>
        Isso vai excluir a coluna{' '}
        <strong style={styles.strong}>{columnLabel}</strong> do board. Essa
        ação não pode ser desfeita.
      </>
    );
  } else if (reason === 'coluna_concluida') {
    body = (
      <>
        <strong style={styles.strong}>{columnLabel}</strong> é a coluna
        concluída do board. Marque outra coluna como concluída antes de
        excluir esta.
      </>
    );
  } else if (reason === 'coluna_com_cards') {
    body = (
      <>
        A coluna <strong style={styles.strong}>{columnLabel}</strong> ainda
        tem <strong style={styles.strong}>{cards} card(s)</strong>. Mova todos
        para outra coluna antes de excluí-la.
      </>
    );
  } else {
    // Refused for a reason this build does not recognise. Say so plainly
    // rather than inventing an explanation — and offer no way to retry the
    // deletion the server just rejected.
    body = (
      <>
        Não foi possível excluir a coluna{' '}
        <strong style={styles.strong}>{columnLabel}</strong>.
      </>
    );
  }

  return (
    <>
      <div
        data-testid="board-column-delete-backdrop"
        style={styles.backdrop}
        onClick={deleting ? undefined : onClose}
      />
      <div style={styles.sheet} role="dialog" aria-label={title}>
        <div style={styles.title}>{title}</div>
        <div style={styles.body}>{body}</div>

        {isConfirm && (
          <button
            type="button"
            style={{ ...styles.action(deleting), ...styles.destructive }}
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? 'Excluindo…' : 'Excluir coluna'}
          </button>
        )}
        <button
          type="button"
          style={{ ...styles.action(deleting), ...styles.cancel }}
          disabled={deleting}
          onClick={onClose}
        >
          {reason === 'coluna_concluida' ? 'Entendi' : 'Cancelar'}
        </button>
      </div>
    </>
  );
}
