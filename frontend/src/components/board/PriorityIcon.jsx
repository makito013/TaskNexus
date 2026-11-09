// Priority glyph for a card: chevrons pointing up (more urgent) or down (less
// urgent), "=" for média. Inline SVG painted with `currentColor`, so the
// level's v2 token drives it in both themes. The shape carries the meaning on
// its own (not only the colour), and the label goes to `title`/`aria-label`.
import { CARD_PRIORIDADE_COLORS, CARD_PRIORIDADE_LABELS } from '../../utils/cardMeta.js';

const UP = 'M4 10l4-4 4 4';
const DOWN = 'M4 6l4 4 4-4';

const PATHS = {
  muito_alta: [{ d: UP, dy: -2.5 }, { d: UP, dy: 2.5 }],
  alta: [{ d: UP, dy: 0 }],
  media: [{ d: 'M4 6h8', dy: 0 }, { d: 'M4 10h8', dy: 0 }],
  baixa: [{ d: DOWN, dy: 0 }],
  muito_baixa: [{ d: DOWN, dy: -2.5 }, { d: DOWN, dy: 2.5 }],
};

export function PriorityIcon({ prioridade, size = 16 }) {
  const paths = PATHS[prioridade];
  if (!paths) return null;
  const label = `Prioridade: ${CARD_PRIORIDADE_LABELS[prioridade]}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid={`priority-icon-${prioridade}`}
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        color: CARD_PRIORIDADE_COLORS[prioridade],
      }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        {paths.map(({ d, dy }, i) => (
          <path
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            d={d}
            transform={dy ? `translate(0 ${dy})` : undefined}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </span>
  );
}
