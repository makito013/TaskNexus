// frontend/src/layouts/v2/CenteredModal.jsx
//
// Centered modal primitive — the desktop/iPad-landscape sibling of
// BottomSheet. Dumb: scrim + panel + entry animation, no domain chrome.
// Whoever uses it mounts header/body/footer as `children` (NewChatSheet
// does this). Does not refactor or rename anything in CardFormModal.
//
// Portalized to document.body (via ReactDOM.createPortal): AppV2 applies
// `inert` to the shell's main-content wrapper while this modal is open, and
// this modal must NOT be a descendant of that wrapper, or the `inert`
// would also disable the modal itself. See DEV.md / style-guide.md §1.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const styles = {
  // Mirrors CardFormModal's styles.overlay. Centered via FLEXBOX. ZERO
  // transform — the v2 shell forbids transform on any ancestor of a
  // position:fixed element (fixedPositioningInvariant.test.js).
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    background: 'var(--v2-scrim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
  },
  panel: {
    position: 'relative',
    zIndex: 61,
    maxWidth: 'min(520px, calc(100vw - 48px))',
    maxHeight: 'min(560px, calc(100vh - 48px))',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    boxShadow: 'var(--v2-shadow-lg)',
    overflow: 'hidden',
    // Visible focus indicator lives in the .v2-centered-modal-panel CSS
    // class (theme.css) — style={} inline doesn't support :focus-visible.
    outline: 'none',
  },
};

export function CenteredModal({
  open,
  onClose,
  children,
  ariaLabel,            // accessible name of role="dialog" = the visible title string
  initialFocusRef,      // 1st <select> of the form — NEVER a text input (iPad keyboard)
}) {
  const panelRef = useRef(null);
  // mousedown vs mouseup: a `click` resolves to the common ancestor of both,
  // so releasing the mouse outside the panel after interacting with a
  // <select> would read as "clicked the overlay" and close it. Default true
  // = a plain click still closes.
  const pressStartedOnOverlay = useRef(true);

  // ESC closes. Listener only while open; removed on unmount/close.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Initial focus: on the 1st <select>, otherwise on the panel (parity with
  // CardFormModal).
  useEffect(() => {
    if (!open) return;
    (initialFocusRef?.current || panelRef.current)?.focus();
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      style={styles.overlay}
      data-testid="centered-modal-scrim"
      onMouseDown={(e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressStartedOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="v2-card-modal-enter v2-centered-modal-panel"
        style={styles.panel}
        data-testid="centered-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {/* children = header (flex-shrink:0) + body (flex:1; min-height:0;
            overflow-y:auto) + footer (flex-shrink:0). The primitive does not
            enforce this structure — it's a contract of the caller, same as
            BottomSheet's fixedFooter. */}
        {children}
      </div>
    </div>,
    document.body,
  );
}
