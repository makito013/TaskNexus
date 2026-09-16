// frontend/src/components/board/BoardColumnMenu.jsx
// The "⋯" overflow menu in a board column header (task #43, phase 1).
//
// Two items only — "Marcar como concluída" and "Excluir coluna". Renaming and
// reordering are NOT here: they are direct manipulations on the header itself
// (click the title, click the arrows), and burying them one level deep in a
// menu would make the common actions slower than the rare ones.
//
// Done is a RADIO, not a toggle: exactly one column is the done column, always.
// So on the column that already carries the mark, the item is replaced by a
// non-clickable informational line instead of being rendered as a checked
// toggle the user could uncheck — unchecking would have to mean "no column is
// done", which the backend's partial unique index does not allow and the
// product decision forbids.
//
// Two of the three deletion refusals are pre-empted right here, with the item
// born disabled plus a `title`, instead of being discovered by pressing a
// destructive button and getting a 409 back:
//
//   - the LAST remaining column, and
//   - the DONE column — this component already knows `is_done`, so sending the
//     user through a guaranteed-to-fail round-trip taught them nothing the
//     menu could not have said up front.
//
// The third (the column still holds N cards) genuinely cannot be pre-empted:
// only the server can count, because the board may be showing a filtered
// subset and subcards count too. That one still opens the dialog.

import { useEffect, useRef } from 'react';

const styles = {
  wrapper: { position: 'relative', flexShrink: 0 },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    padding: 0,
    borderRadius: '6px',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '14px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  popover: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: '200px',
    padding: '4px',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '8px',
    boxShadow: 'var(--v2-shadow)',
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  item: (disabled, danger) => ({
    display: 'block',
    width: '100%',
    padding: '8px 10px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    font: 'inherit',
    fontSize: '12px',
    // Disabled reads as a COLOUR change, never `opacity`: opacity fades the
    // whole box including its background, which on this surface turns into a
    // smudge rather than a state.
    color: disabled
      ? 'var(--v2-text-faint)'
      : (danger ? 'var(--v2-danger)' : 'var(--v2-text)'),
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  info: {
    display: 'block',
    padding: '8px 10px',
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
  },
};

export function BoardColumnMenu({
  columnLabel,
  isDone,
  isLastColumn,
  open,
  onToggle,
  onMarkDone,
  onRequestDelete,
}) {
  const wrapperRef = useRef(null);

  // The last-column check comes first: on a board down to one column that
  // column is also the done one, and "the board needs at least one column" is
  // the more actionable of the two messages.
  const deleteBlockedReason = isLastColumn
    ? 'O board precisa ter pelo menos uma coluna.'
    : (isDone
      ? 'A coluna concluída não pode ser excluída. Marque outra coluna como concluída antes.'
      : undefined);
  const deleteBlocked = deleteBlockedReason !== undefined;

  // Click-outside and Escape both close. Bound only while open, so a board
  // with twelve columns does not carry twelve idle document listeners.
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        onToggle(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onToggle(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onToggle]);

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      <button
        type="button"
        style={styles.trigger}
        aria-label={`Ações da coluna ${columnLabel}`}
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        ⋯
      </button>

      {open && (
        <div style={styles.popover} role="menu" data-testid="board-column-menu">
          {isDone ? (
            <span style={styles.info}>✓ Esta é a coluna concluída</span>
          ) : (
            <button
              type="button"
              role="menuitem"
              style={styles.item(false, false)}
              onClick={() => { onToggle(false); onMarkDone(); }}
            >
              Marcar como concluída
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            style={styles.item(deleteBlocked, true)}
            disabled={deleteBlocked}
            title={deleteBlockedReason}
            onClick={() => { onToggle(false); onRequestDelete(); }}
          >
            Excluir coluna
          </button>
        </div>
      )}
    </div>
  );
}
