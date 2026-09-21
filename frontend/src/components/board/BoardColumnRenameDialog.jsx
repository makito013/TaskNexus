// frontend/src/components/board/BoardColumnRenameDialog.jsx
// Renaming a board column (task #43, phase 2 revision).
//
// Renaming used to be "click the column title, it becomes an input". That had
// to go when the whole header became the drag surface: click-to-edit and
// click-and-drag were competing for the same gesture on the same pixels, and
// the ambiguity resolves differently depending on how far the pointer happens
// to move. Renaming is now an explicit item in the "⋯" menu that opens this
// dialog.
//
// Visually this is the SIBLING of BoardColumnDeleteDialog — same bottom sheet,
// same tokens, same action-button pair — because the two are reached from the
// same menu, one item apart, and looking different would be noise. NOTE: that
// sibling does NOT use the `CenteredModal` primitive (it predates this round
// with its own sheet), so neither does this; matching the sibling was the
// point. See the DEV report.
//
// Only the SLUG is immutable; the label is free text. Validation lives on the
// backend (blank, or duplicate case-insensitively) and its message is shown
// INLINE here — the old inline input reverted silently on rejection, which
// left the user retyping the same duplicate name with no idea why it kept
// snapping back.

import { useEffect, useRef, useState } from 'react';

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
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: '44px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    font: 'inherit',
    fontSize: '14px',
  },
  error: {
    fontSize: '13px',
    color: 'var(--v2-danger)',
    lineHeight: 1.4,
  },
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
    // Disabled reads as a colour change, never opacity — same rule as the
    // column arrows and the menu items.
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
  }),
  cancel: { color: 'var(--v2-text-dim)', background: 'var(--v2-surface-2)' },
};

export function BoardColumnRenameDialog({
  open,
  columnLabel,
  saving = false,
  error = null,
  onConfirm,
  onClose,
}) {
  const [label, setLabel] = useState(columnLabel ?? '');
  const inputRef = useRef(null);

  // Reset whenever the dialog opens on a (possibly different) column, so it
  // never reopens holding the previous column's draft.
  useEffect(() => {
    if (!open) return;
    setLabel(columnLabel ?? '');
  }, [open, columnLabel]);

  // Autofocus with the text SELECTED — the same affordance the inline input
  // had, where the whole name was already highlighted and typing replaced it.
  //
  // CenteredModal's docs warn against focusing a text input on open (it pops
  // the iPad keyboard). That warning is about forms whose first control merely
  // happens to be text; here the input IS the entire dialog, so raising the
  // keyboard is the wanted outcome, not a side effect.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const trimmed = label.trim();
  // Blank is blocked here so the obvious mistake needs no round-trip; every
  // other rule (duplicate, case-insensitive) is the backend's and arrives via
  // `error`.
  const canConfirm = trimmed.length > 0 && !saving;
  const title = `Renomear coluna — ${columnLabel}`;

  const submit = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  };

  return (
    <>
      <div
        data-testid="board-column-rename-backdrop"
        style={styles.backdrop}
        onClick={saving ? undefined : onClose}
      />
      <div style={styles.sheet} role="dialog" aria-label={title}>
        <div style={styles.title}>{title}</div>
        <div style={styles.body}>
          <input
            ref={inputRef}
            style={styles.input}
            value={label}
            disabled={saving}
            aria-label="Novo nome da coluna"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              // Enter confirms. Escape is handled by the document listener
              // above so it works from anywhere in the sheet.
              if (e.key === 'Enter') submit();
            }}
          />
          {error && <div style={styles.error} role="alert">{error}</div>}
        </div>

        <button
          type="button"
          style={styles.action(!canConfirm)}
          disabled={!canConfirm}
          onClick={submit}
        >
          {saving ? 'Salvando…' : 'Confirmar'}
        </button>
        <button
          type="button"
          style={{ ...styles.action(saving), ...styles.cancel }}
          disabled={saving}
          onClick={onClose}
        >
          Cancelar
        </button>
      </div>
    </>
  );
}
