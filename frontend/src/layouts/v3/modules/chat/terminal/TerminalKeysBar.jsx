// Key bar under the terminal on a phone (<= 767, Designer 11.1): the keys a soft keyboard does not have. Bytes
// go straight to the PTY through `sendControlByte` of the terminal (the same ones the V2 shortcut panel sends:
// layouts/v2/TerminalShortcutsPanel.jsx), never through xterm's own key handling.
//   onSend(bytes)         Uint8Array | string
//   ctrlArmed / onToggleCtrl   "Ctrl" is a sticky modifier: armed, the next single-character key typed in the
//                         terminal goes out as its control byte (the frame applies it)
// Every button carries `data-terminal-safe-tap` (a tap outside the terminal would blur its textarea and close the
// soft keyboard) and keeps the terminal focused on press. 44 x 44 minimum (CSS).
export const KEYS = [
  { id: 'esc', label: 'Esc', aria: 'Esc', bytes: new Uint8Array([0x1b]) },
  { id: 'tab', label: 'Tab', aria: 'Tab', bytes: '\t' },
  { id: 'ctrl', label: 'Ctrl', aria: 'Ctrl, vale para a próxima tecla', modifier: true },
  { id: 'up', label: '↑', aria: 'Seta para cima', bytes: '\x1b[A' },
  { id: 'down', label: '↓', aria: 'Seta para baixo', bytes: '\x1b[B' },
  { id: 'ctrl-c', label: 'Ctrl+C', aria: 'Ctrl+C', bytes: new Uint8Array([0x03]) },
]

export default function TerminalKeysBar({ onSend, ctrlArmed = false, onToggleCtrl, disabled = false }) {
  return (
    <div className="v3-term__keys" role="toolbar" aria-label="Teclas do terminal">
      {KEYS.map((key) => (
        <button
          key={key.id}
          type="button"
          className="v3-term__key"
          aria-label={key.aria}
          aria-pressed={key.modifier ? ctrlArmed : undefined}
          aria-disabled={disabled ? 'true' : undefined}
          data-terminal-safe-tap="true"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (disabled) return
            if (key.modifier) onToggleCtrl()
            else onSend(key.bytes)
          }}
        >
          {key.label}
        </button>
      ))}
    </div>
  )
}
