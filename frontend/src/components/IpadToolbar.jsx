// frontend/src/components/IpadToolbar.jsx
// Floating control toolbar for iPad Safari — TERM-03
// Renders ONLY on touch/coarse-pointer devices (D-09).
// Sends raw control bytes directly to the PTY WebSocket,
// bypassing xterm.js keyboard handling (D-10, D-11).

import { useIsTouchDevice } from '../hooks/useIsTouchDevice.js';

// Exact 5-button spec from 03-UI-SPEC.md (D-10/D-11)
const CONTROLS = [
  { label: '^C',  ariaLabel: 'Ctrl+C',            payload: new Uint8Array([0x03]) },
  { label: 'Tab', ariaLabel: 'Tab',                payload: '\t' },
  { label: '↑',   ariaLabel: 'Seta para cima',     payload: '\x1b[A' },
  { label: '↓',   ariaLabel: 'Seta para baixo',    payload: '\x1b[B' },
  { label: 'Esc', ariaLabel: 'Esc',                payload: new Uint8Array([0x1b]) },
];

const btnStyle = {
  width: '44px',
  height: '44px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-active)',
  color: 'var(--text-primary)',
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
 * IpadToolbar — renders only on touch/coarse-pointer devices.
 * `panelRef` must be a ref to a TerminalPanel instance exposing
 * `sendControlByte(payload)` via useImperativeHandle.
 */
export function IpadToolbar({ panelRef }) {
  // D-09: hard gate — never render on non-touch devices. Detection now
  // lives in useIsTouchDevice.js (shared with layouts/v2/TerminalShortcutsFab.jsx).
  const isTouch = useIsTouchDevice();

  // Return null (not hidden) on non-touch devices — D-09
  if (!isTouch) return null;

  return (
    <div style={{
      height: '44px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 8px',
      background: 'var(--bg-surface-2)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {CONTROLS.map(({ label, ariaLabel, payload }) => (
        <button
          key={label}
          aria-label={ariaLabel}
          title={ariaLabel}
          style={btnStyle}
          // D-10: this button must NOT steal terminal focus on tap. It also
          // opts out of TerminalPanel's outside-tap blur fix (bug 2,
          // 2026-07-16) via data-terminal-safe-tap — otherwise that fix would
          // blur the terminal's hidden textarea on every toolbar tap and
          // break the very "keep typing after pressing ^C/Tab/arrows/Esc"
          // behavior D-10 exists for.
          data-terminal-safe-tap="true"
          onPointerDown={(e) => {
            // Prevent losing terminal focus on tap — D-10
            e.preventDefault();
            panelRef?.current?.sendControlByte(payload);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
