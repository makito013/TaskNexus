// frontend/src/utils/cardMeta.js
// Pure helpers for the two card fields added in this round: `tipo`
// (informational bug/hotfix/historia) and `prazo` (a due date, stored as a
// plain "YYYY-MM-DD" string — the backend does not validate the format).
//
// The domain values `bug`/`hotfix`/`historia` and the field names `tipo`/
// `prazo` stay in PT-BR: they are the persisted contract, shared with the
// MCP tools the agents call.
//
// Every function takes "today" as an explicit optional parameter. Reading
// the global clock inside would make the tests hostage to the day they run.

export const CARD_TIPOS = ['bug', 'hotfix', 'historia'];

// User-facing labels — PT-BR on purpose, the product is PT-BR.
export const CARD_TIPO_LABELS = {
  bug: 'BUG',
  hotfix: 'HOTFIX',
  historia: 'HISTÓRIA',
};

// Soft background + strong foreground per tipo, both v2 tokens so the chip
// follows the active theme. `--v2-warn-soft` was created for hotfix in this
// round and exists in BOTH theme blocks of theme.css (there is no bare
// `:root` for v2 tokens — a token defined once is invisible in one theme).
export const CARD_TIPO_COLORS = {
  bug: { soft: 'var(--v2-danger-soft)', strong: 'var(--v2-danger)' },
  hotfix: { soft: 'var(--v2-warn-soft)', strong: 'var(--v2-warn)' },
  historia: { soft: 'var(--v2-accent-2-soft)', strong: 'var(--v2-accent-2)' },
};

const MONTH_ABBR = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

// "YYYY-MM-DD" -> { year, month, day }, or null when unparseable. Parsed by
// hand instead of `new Date(str)` because that constructor reads a bare date
// string as UTC midnight and then renders it in local time, which shifts the
// day backwards for every negative-offset timezone — including this app's.
function parseIsoDate(prazo) {
  if (typeof prazo !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prazo.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// "2026-08-30" -> "30 ago" in the current year, "30 ago 2027" outside it.
// Anything that does not parse is echoed back verbatim: the backend accepts
// free-form strings, and showing the raw value beats showing nothing.
export function formatPrazo(prazo, today = new Date()) {
  if (!prazo) return '';
  const parsed = parseIsoDate(prazo);
  if (!parsed) return String(prazo);
  const label = `${parsed.day} ${MONTH_ABBR[parsed.month - 1]}`;
  return parsed.year === today.getFullYear() ? label : `${label} ${parsed.year}`;
}

// A card is late when its due date is strictly before today AND it is not
// done. A done card with a past due date is not late — it was delivered.
//
// `doneSlug` sits BEFORE `today` in the signature on purpose. "Done" is no
// longer the literal 'feito' — it is whichever column carries is_done, which
// the user can move (task #43). Putting the new parameter last would let an
// un-migrated call site keep compiling and silently mark delivered cards as
// late; putting it third breaks such a call visibly (a Date lands where a
// slug is expected) the first time anyone looks at the screen.
//
// `doneSlug` null/undefined (columns not loaded yet) means "nothing is known
// to be done", so a card with a past due date reads as late for the one frame
// before the columns arrive — the honest answer with no data, and the caller
// re-renders as soon as they do.
export function isPrazoAtrasado(prazo, status, doneSlug, today = new Date()) {
  if (!prazo || (doneSlug != null && status === doneSlug)) return false;
  const parsed = parseIsoDate(prazo);
  if (!parsed) return false;
  const due = new Date(parsed.year, parsed.month - 1, parsed.day);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return due < startOfToday;
}

// "2026-08-30T12:34:56" / "2026-08-30" -> "30/08/2026". Used for the
// read-only "Criado em" row, which shows a full date rather than the short
// form `formatPrazo` produces.
export function formatDataCriacao(criadoEm) {
  if (!criadoEm) return '';
  const parsed = parseIsoDate(String(criadoEm).slice(0, 10));
  if (!parsed) return String(criadoEm);
  const dd = String(parsed.day).padStart(2, '0');
  const mm = String(parsed.month).padStart(2, '0');
  return `${dd}/${mm}/${parsed.year}`;
}
