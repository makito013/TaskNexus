// frontend/src/layouts/v2/TerminalShortcutsBar.jsx
// Touch-only control bar for the terminal in the v2 layout (ChatV2.jsx):
// gives Esc, Shift+Tab, Enter, and Alt+Enter (newline) to devices whose
// on-screen keyboard has no physical keys for them, plus the same
// Ctrl+C/Tab/arrows set already proven in components/IpadToolbar.jsx (v1).
// Bytes go straight to the PTY WebSocket via TerminalPanel's
// sendControlByte (frontend/src/components/TerminalPanel.jsx), bypassing
// xterm.js's own keyboard handling entirely — same mechanism as v1.
import { useRef } from 'react';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice.js';

// The row scrolls horizontally (8 buttons don't fit on a narrow phone), but
// each button also needs preventDefault() on its own down-event so tapping
// it doesn't shift DOM focus away from the terminal's hidden textarea mid-
// session (same requirement as components/IpadToolbar.jsx). Firing that
// preventDefault() unconditionally on pointerdown — as IpadToolbar.jsx does —
// stops the browser from ever recognizing a horizontal drag that *starts* on
// a button, which is nearly every drag here since the buttons cover almost
// the entire row width. So each button (see ShortcutButton below) defers the
// decision to pointerup: it only preventDefault()s + sends its payload if
// the pointer stayed within TAP_SLOP_PX of where it went down (a tap); past
// that, it was a scroll drag, and the button does nothing, leaving the
// browser's native horizontal scroll uninterrupted for that gesture.
const TAP_SLOP_PX = 10;

const CONTROLS = [
  { label: 'Esc',  ariaLabel: 'Esc',                   payload: new Uint8Array([0x1b]) },
  { label: '⇧Tab', ariaLabel: 'Shift+Tab',              payload: '\x1b[Z' },
  { label: 'Tab',  ariaLabel: 'Tab',                    payload: '\t' },
  { label: '↑',    ariaLabel: 'Seta para cima',         payload: '\x1b[A' },
  { label: '↓',    ariaLabel: 'Seta para baixo',        payload: '\x1b[B' },
  { label: '↵',    ariaLabel: 'Enter',                  payload: '\r' },
  { label: '⌥↵',   ariaLabel: 'Nova linha (Alt+Enter)', payload: '\x1b\r' },
  { label: '^C',   ariaLabel: 'Ctrl+C',                 payload: new Uint8Array([0x03]) },
];

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 16px',
  overflowX: 'auto',
  touchAction: 'pan-x',
  WebkitOverflowScrolling: 'touch',
  background: 'var(--v2-surface-2)',
  borderBottom: '1px solid var(--v2-border)',
  flexShrink: 0,
};

const btnStyle = {
  width: 'var(--touch-target, 44px)',
  height: 'var(--touch-target, 44px)',
  borderRadius: 'var(--radius-sm, 8px)',
  border: '1px solid var(--v2-border)',
  background: 'var(--v2-surface-3)',
  color: 'var(--v2-text)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  flexShrink: 0,
};

/**
 * ShortcutButton — one button in the bar. Tracks the pointer's down
 * position in a ref (not state — a drag can fire many pointermove events
 * per frame, and none of this needs a re-render) and only treats the
 * gesture as a tap, firing preventDefault() + the payload, if the pointer
 * never moved past TAP_SLOP_PX before going up. A drag that starts on the
 * button is left alone: no preventDefault() at any point, so the row's own
 * horizontal scroll is free to take it.
 */
function ShortcutButton({ label, ariaLabel, payload, panelRef }) {
  const downPosRef = useRef(null);

  const handlePointerDown = (e) => {
    downPosRef.current = { x: e.clientX, y: e.clientY, dragging: false };
  };

  const handlePointerMove = (e) => {
    const down = downPosRef.current;
    if (!down || down.dragging) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      down.dragging = true;
    }
  };

  const handlePointerUp = (e) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down || down.dragging) return; // was a scroll drag — let it stand, don't fire
    e.preventDefault();
    panelRef?.current?.sendControlByte(payload);
  };

  const handlePointerCancel = () => {
    downPosRef.current = null;
  };

  return (
    <button
      aria-label={ariaLabel}
      title={ariaLabel}
      style={btnStyle}
      // Same D-10 fix as IpadToolbar.jsx: don't steal terminal focus on
      // tap, and opt out of TerminalPanel's outside-tap blur handler via
      // data-terminal-safe-tap so the user can keep typing right after
      // tapping a shortcut.
      data-terminal-safe-tap="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {label}
    </button>
  );
}

/**
 * TerminalShortcutsBar — touch-only (hard gate: returns null otherwise).
 * `panelRef` must be a ref to a TerminalPanel instance exposing
 * `sendControlByte(payload)` via useImperativeHandle.
 */
export function TerminalShortcutsBar({ panelRef }) {
  const isTouch = useIsTouchDevice();
  if (!isTouch) return null;

  return (
    <div style={rowStyle}>
      {CONTROLS.map(({ label, ariaLabel, payload }) => (
        <ShortcutButton key={ariaLabel} label={label} ariaLabel={ariaLabel} payload={payload} panelRef={panelRef} />
      ))}
    </div>
  );
}
