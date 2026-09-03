// frontend/src/components/board/CardIdBadge.jsx
// The card's numeric id, made visible and copyable.
//
// Why it exists: the id is how Bruno hands a card to an agent ("edite o card
// 128"). Until now it only lived in the database, so it had to be guessed
// from the URL of an image or read off an agent's own reply.
//
// The label shows `#123`, but the copy button puts the BARE `123` on the
// clipboard — that is what an agent prompt needs, and pasting `#123` forces a
// manual edit every single time.
//
// Two variants: 'card' (compact, on the board card face) and 'modal'
// (slightly larger, in the modal header, where the client name has room).
import { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../utils/clipboard.js';

const FEEDBACK_MS = { card: 1200, modal: 1400 };

const styles = {
  wrapper: (variant) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: variant === 'modal' ? '8px' : '6px',
    minWidth: 0,
  }),
  id: (variant) => ({
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: variant === 'modal' ? '13px' : '11px',
    fontWeight: 600,
    color: 'var(--v2-text-dim)',
    letterSpacing: '.02em',
    flexShrink: 0,
  }),
  copyBtn: (variant, state) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: variant === 'modal' ? '26px' : '20px',
    height: variant === 'modal' ? '26px' : '20px',
    padding: 0,
    borderRadius: '6px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: state === 'error' ? 'var(--v2-danger)' : 'var(--v2-text-faint)',
    fontSize: variant === 'modal' ? '13px' : '11px',
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
  }),
  cliente: (variant) => ({
    fontSize: variant === 'modal' ? '12px' : '10px',
    color: 'var(--v2-text-faint)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  }),
};

const GLYPHS = { idle: '⧉', success: '✓', error: '!' };

export function formatCardId(id) {
  return `#${id}`;
}

export function CardIdBadge({ id, clienteNome, variant = 'card' }) {
  // 'idle' | 'success' | 'error'
  const [copyState, setCopyState] = useState('idle');
  const timerRef = useRef(null);

  // The feedback glyph resets on a timer, and the badge on a card face is
  // unmounted by any poll that drops the card — clearing on unmount is what
  // keeps that from setting state on a dead component.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async (event) => {
    // The card face wraps this badge in a clickable card; without this the
    // copy click would also open the modal.
    event.stopPropagation();
    const ok = await copyTextToClipboard(String(id));
    setCopyState(ok ? 'success' : 'error');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopyState('idle'), FEEDBACK_MS[variant] ?? FEEDBACK_MS.card);
  };

  return (
    <span style={styles.wrapper(variant)}>
      <span style={styles.id(variant)}>{formatCardId(id)}</span>
      <button
        type="button"
        style={styles.copyBtn(variant, copyState)}
        aria-label={`Copiar ID ${id}`}
        title={copyState === 'error' ? 'Não foi possível copiar' : `Copiar ID ${id}`}
        onClick={handleCopy}
      >
        {GLYPHS[copyState]}
      </button>
      {clienteNome && <span style={styles.cliente(variant)}>{clienteNome}</span>}
    </span>
  );
}
