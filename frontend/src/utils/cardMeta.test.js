// frontend/src/utils/cardMeta.test.js
import { describe, it, expect } from 'vitest';
import {
  CARD_TIPOS,
  CARD_TIPO_COLORS,
  CARD_TIPO_LABELS,
  formatDataCriacao,
  formatDateTime,
  formatPrazo,
  isPrazoAtrasado,
} from './cardMeta.js';

// Explicit "today" everywhere — never the real clock.
const today = new Date(2026, 8, 3); // 2026-09-03

describe('CARD_TIPO_LABELS / CARD_TIPO_COLORS', () => {
  it('covers every tipo with a label and a soft/strong color pair', () => {
    for (const tipo of CARD_TIPOS) {
      expect(CARD_TIPO_LABELS[tipo]).toBeTruthy();
      expect(CARD_TIPO_COLORS[tipo].soft).toMatch(/^var\(--v2-/);
      expect(CARD_TIPO_COLORS[tipo].strong).toMatch(/^var\(--v2-/);
    }
  });
});

describe('formatPrazo', () => {
  it('omits the year inside the current year', () => {
    expect(formatPrazo('2026-08-30', today)).toBe('30 ago');
  });

  it('appends the year outside the current year', () => {
    expect(formatPrazo('2027-01-05', today)).toBe('5 jan 2027');
    expect(formatPrazo('2025-12-31', today)).toBe('31 dez 2025');
  });

  it('does not shift the day across the timezone boundary', () => {
    // `new Date('2026-01-01')` is UTC midnight, which renders as 2025-12-31
    // in any negative-offset timezone. Manual parsing avoids that.
    expect(formatPrazo('2026-01-01', today)).toBe('1 jan');
  });

  it('returns an empty string for a missing prazo', () => {
    expect(formatPrazo(null, today)).toBe('');
    expect(formatPrazo('', today)).toBe('');
  });

  it('echoes an unparseable value verbatim (the backend accepts free text)', () => {
    expect(formatPrazo('amanhã', today)).toBe('amanhã');
  });
});

describe('isPrazoAtrasado', () => {
  it('is true for a past date on a card that is not done', () => {
    expect(isPrazoAtrasado('2026-09-02', 'a_fazer', 'feito', today)).toBe(true);
  });

  it('is false today and in the future', () => {
    expect(isPrazoAtrasado('2026-09-03', 'a_fazer', 'feito', today)).toBe(false);
    expect(isPrazoAtrasado('2026-09-04', 'a_fazer', 'feito', today)).toBe(false);
  });

  it('is ALWAYS false when the card is done, however old the prazo', () => {
    expect(isPrazoAtrasado('2020-01-01', 'feito', 'feito', today)).toBe(false);
  });

  it('is false without a prazo, and false for an unparseable one', () => {
    expect(isPrazoAtrasado(null, 'a_fazer', 'feito', today)).toBe(false);
    expect(isPrazoAtrasado('amanhã', 'a_fazer', 'feito', today)).toBe(false);
  });

  // Done-ness follows the is_done COLUMN, not the literal 'feito' string —
  // the user can move the mark to any column (task #43).
  it('follows the done column when the mark moves off "feito"', () => {
    expect(isPrazoAtrasado('2020-01-01', 'em_revisao', 'em_revisao', today)).toBe(false);
    // ...and 'feito' stops being special once it is no longer the done column.
    expect(isPrazoAtrasado('2020-01-01', 'feito', 'em_revisao', today)).toBe(true);
  });

  it('treats a null doneSlug (columns not loaded yet) as "nothing is done"', () => {
    expect(isPrazoAtrasado('2020-01-01', 'feito', null, today)).toBe(true);
  });
});

describe('formatDataCriacao', () => {
  it('formats an ISO timestamp as dd/mm/yyyy', () => {
    expect(formatDataCriacao('2026-08-30T12:34:56')).toBe('30/08/2026');
  });

  it('formats a bare ISO date too', () => {
    expect(formatDataCriacao('2026-01-05')).toBe('05/01/2026');
  });

  it('returns an empty string for a missing value', () => {
    expect(formatDataCriacao(null)).toBe('');
  });
});

describe('formatDateTime', () => {
  it('formats an epoch-seconds number (backend format) as dd/mm/yyyy hh:mm', () => {
    const epochSeconds = new Date(2026, 8, 22, 14, 30).getTime() / 1000;
    expect(formatDateTime(epochSeconds)).toBe('22/09/2026 14:30');
  });

  it('formats an ISO string (useGlobalTasks.js optimistic-path format) the same way', () => {
    const iso = new Date(2026, 8, 22, 14, 30).toISOString();
    expect(formatDateTime(iso)).toBe(formatDateTime(new Date(iso).getTime() / 1000));
  });

  it('returns an empty string for null/undefined', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  it('returns an empty string for an unparseable value instead of "Invalid Date"', () => {
    expect(formatDateTime('not-a-date')).toBe('');
  });
});
