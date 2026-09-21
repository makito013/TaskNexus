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
// RESPONSIVE (Bruno's call after testing phase 2 live): bottom sheet on a
// phone, real centred modal on desktop, with the actions SIDE BY SIDE rather
// than stacked. That is not a new mechanism — it is exactly what
// `NewChatSheet` already does, down to the 640px breakpoint and the two
// container primitives, so this file reuses the pattern instead of inventing
// a parallel one. The only deviation: `NewChatSheet` receives `presentation`
// as a prop from AppV2, while these dialogs read the breakpoint themselves,
// which is what `CardFormModal` (the other board surface) already does and
// keeps BoardV2 from threading a prop it has no opinion about.
//
// Visually the sheet mode stays the SIBLING of BoardColumnDeleteDialog — same
// tokens, same action pair — because the two are reached from the same menu,
// one item apart.
//
// Only the SLUG is immutable; the label is free text. Validation lives on the
// backend (blank, or duplicate case-insensitively) and its message is shown
// INLINE here — the old inline input reverted silently on rejection, which
// left the user retyping the same duplicate name with no idea why it kept
// snapping back.

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { BottomSheet } from '../../layouts/v2/BottomSheet.jsx';
import { CenteredModal } from '../../layouts/v2/CenteredModal.jsx';
import { MOBILE_VIEWPORT_QUERY } from '../../utils/viewport.js';

const styles = {
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

  // -- sheet mode: full-width actions stacked, thumb-reachable --------------
  sheetAction: (disabled) => ({
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
    // menu items.
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
  }),
  sheetCancel: { color: 'var(--v2-text-dim)', background: 'var(--v2-surface-2)' },

  // -- modal mode: the 3 regions CenteredModal expects ----------------------
  // Same measurements as NewChatSheet's modal chrome, so the two centred
  // modals in the app read as one component family.
  modalHeader: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  modalHeaderTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  modalCloseBtn: {
    width: '40px',
    height: '40px',
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
  modalBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  modalFooter: {
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '12px 16px',
    borderTop: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  modalCancelBtn: {
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  modalSubmitBtn: (disabled) => ({
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-accent)',
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
};

export function BoardColumnRenameDialog({
  open,
  columnLabel,
  saving = false,
  error = null,
  onConfirm,
  onClose,
}) {
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
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
  // keyboard is the wanted outcome, not a side effect. In modal mode the input
  // is also handed over as `initialFocusRef`, or CenteredModal would focus its
  // panel afterwards and drop the selection this effect just made.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

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

  // Both containers own their Escape handling and their scrim click, so this
  // component no longer registers a key listener of its own — it only guards
  // the close against firing mid-save.
  const requestClose = () => { if (!saving) onClose(); };

  const input = (
    <input
      ref={inputRef}
      style={styles.input}
      value={label}
      disabled={saving}
      aria-label="Novo nome da coluna"
      onChange={(e) => setLabel(e.target.value)}
      onKeyDown={(e) => {
        // Enter confirms. Escape belongs to the container.
        if (e.key === 'Enter') submit();
      }}
    />
  );
  const errorNode = error ? <div style={styles.error} role="alert">{error}</div> : null;

  if (!isMobile) {
    return (
      // No `role`/`aria-label` here: CenteredModal already renders
      // role="dialog" + aria-modal + the accessible name from `ariaLabel`.
      // Adding our own would put TWO dialogs in the tree for one dialog.
      <CenteredModal
        open
        onClose={requestClose}
        ariaLabel={title}
        initialFocusRef={inputRef}
      >
        <header style={styles.modalHeader}>
          <span style={styles.modalHeaderTitle}>{title}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            style={styles.modalCloseBtn}
            onClick={requestClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <div style={styles.modalBody}>
          {input}
          {errorNode}
        </div>

        {/* Side by side, confirm last — the desktop convention, and the same
            footer NewChatSheet uses. */}
        <footer style={styles.modalFooter}>
          <button
            type="button"
            style={styles.modalCancelBtn}
            disabled={saving}
            onClick={requestClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            style={styles.modalSubmitBtn(!canConfirm)}
            disabled={!canConfirm}
            onClick={submit}
          >
            {saving ? 'Salvando…' : 'Confirmar'}
          </button>
        </footer>
      </CenteredModal>
    );
  }

  return (
    // BottomSheet is a plain scrim + panel with no dialog semantics of its
    // own, so the role and the name are this component's job in sheet mode —
    // the exact opposite of the modal branch above.
    <BottomSheet open onClose={requestClose}>
      <div role="dialog" aria-modal="true" aria-label={title}>
        <div style={styles.title}>{title}</div>
        <div style={styles.body}>
          {input}
          {errorNode}
        </div>

        <button
          type="button"
          style={styles.sheetAction(!canConfirm)}
          disabled={!canConfirm}
          onClick={submit}
        >
          {saving ? 'Salvando…' : 'Confirmar'}
        </button>
        <button
          type="button"
          style={{ ...styles.sheetAction(saving), ...styles.sheetCancel }}
          disabled={saving}
          onClick={requestClose}
        >
          Cancelar
        </button>
      </div>
    </BottomSheet>
  );
}
