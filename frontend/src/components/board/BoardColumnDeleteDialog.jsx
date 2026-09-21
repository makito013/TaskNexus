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
//
// RESPONSIVE (Bruno's call after testing phase 2 live): bottom sheet on a
// phone, real centred modal on desktop with the actions SIDE BY SIDE. Same
// mechanism as `NewChatSheet` — the 640px breakpoint and the two container
// primitives — reused rather than reinvented, and shared with the rename
// dialog next door so the two stay siblings in both modes.

import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { BottomSheet } from '../../layouts/v2/BottomSheet.jsx';
import { CenteredModal } from '../../layouts/v2/CenteredModal.jsx';
import { MOBILE_VIEWPORT_QUERY } from '../../utils/viewport.js';

// The `reason` the caller uses for "the server has not refused anything; ask
// the user to confirm". Deliberately not a backend refusal code.
const CONFIRM_REASON = 'confirm';

const styles = {
  // No `sheet`/`backdrop` entries any more: BottomSheet renders the scrim and
  // the panel itself, so the hand-rolled pair this file used to carry would
  // have been a second panel inside the first.
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

  // -- modal mode: the 3 regions CenteredModal expects ----------------------
  // Same measurements as NewChatSheet's modal chrome and the rename dialog's,
  // so every centred modal in the app reads as one component family.
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
    fontSize: '14px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.5,
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
  // Danger on the border AND the text, the same pair the sheet variant uses
  // and that CardFormModal's deleteBtn established.
  modalDestructiveBtn: (disabled) => ({
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-danger)',
    background: 'transparent',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-danger)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
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
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);

  if (!open) return null;

  const title = `Excluir coluna — ${columnLabel}`;

  // Both containers own their Escape handling and their scrim click, so this
  // component no longer registers a key listener of its own — it only guards
  // the close against firing mid-delete.
  const requestClose = () => { if (!deleting) onClose(); };

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

  // Wording is identical in both modes — only the layout differs. On the
  // informational variant the sole button says "Entendi", because there is
  // nothing being cancelled.
  const closeLabel = reason === 'coluna_concluida' ? 'Entendi' : 'Cancelar';

  if (!isMobile) {
    return (
      // No `role`/`aria-label` here: CenteredModal already renders
      // role="dialog" + aria-modal + the accessible name from `ariaLabel`.
      <CenteredModal open onClose={requestClose} ariaLabel={title}>
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

        <div style={styles.modalBody}>{body}</div>

        {/* Side by side, destructive action last — same footer geometry as
            NewChatSheet and the rename dialog. */}
        <footer style={styles.modalFooter}>
          <button
            type="button"
            style={styles.modalCancelBtn}
            disabled={deleting}
            onClick={requestClose}
          >
            {closeLabel}
          </button>
          {isConfirm && (
            <button
              type="button"
              style={styles.modalDestructiveBtn(deleting)}
              disabled={deleting}
              onClick={onConfirm}
            >
              {deleting ? 'Excluindo…' : 'Excluir coluna'}
            </button>
          )}
        </footer>
      </CenteredModal>
    );
  }

  return (
    // BottomSheet carries no dialog semantics of its own, so the role and the
    // name are this component's job in sheet mode.
    <BottomSheet open onClose={requestClose}>
      <div role="dialog" aria-modal="true" aria-label={title}>
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
          onClick={requestClose}
        >
          {closeLabel}
        </button>
      </div>
    </BottomSheet>
  );
}
