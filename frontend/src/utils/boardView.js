// frontend/src/utils/boardView.js
// Pure filter + sort of the board's cards (BoardV2's "Filtrar"/"Ordenar"
// toolbar). Kept out of the component so every rule is testable on its own.
//
// Filters are AND-combined; '' means "any". Sorting is stable: ties keep the
// incoming order, which is the board's manual order (board_position).

import { CARD_PRIORIDADES, CARD_TIPOS, PRIORITY_RANK, isPrazoAtrasado, parseIsoDate } from './cardMeta.js';

// Sentinel for "the field is empty" in the prioridade/tipo filters.
export const FILTER_NONE = '__none__';

export const DEFAULT_BOARD_VIEW = Object.freeze({
  prioridade: '',
  tipo: '',
  prazo: '',
  sort: 'manual',
});

export const PRAZO_FILTER_OPTIONS = [
  { value: 'atrasado', label: 'Atrasados' },
  { value: 'com_prazo', label: 'Com prazo' },
  { value: 'sem_prazo', label: 'Sem prazo' },
];

export const BOARD_SORT_OPTIONS = [
  { value: 'manual', label: 'Manual (arrastar)' },
  { value: 'prioridade', label: 'Prioridade (maior primeiro)' },
  { value: 'prazo', label: 'Prazo (mais próximo primeiro)' },
  { value: 'criado_em', label: 'Criação (mais recente primeiro)' },
  { value: 'atualizado_em', label: 'Atualização (mais recente primeiro)' },
  { value: 'titulo', label: 'Título (A–Z)' },
];

export function isBoardViewFiltered(view) {
  return !!(view.prioridade || view.tipo || view.prazo);
}

export function isBoardViewSorted(view) {
  return !!view.sort && view.sort !== 'manual';
}

function matchesValue(filter, value) {
  if (!filter) return true;
  if (filter === FILTER_NONE) return !value;
  return value === filter;
}

function matchesPrazo(filter, card, doneSlug, today) {
  if (!filter) return true;
  if (filter === 'atrasado') return isPrazoAtrasado(card.prazo, card.status, doneSlug, today);
  if (filter === 'com_prazo') return !!card.prazo;
  if (filter === 'sem_prazo') return !card.prazo;
  return true;
}

function prazoKey(card) {
  const parsed = parseIsoDate(card.prazo);
  return parsed ? parsed.year * 10000 + parsed.month * 100 + parsed.day : null;
}

// Sort key + direction per option. Null keys always go last, whatever the
// direction: a card with no prioridade/prazo is never "the most urgent".
const SORT_KEYS = {
  prioridade: { key: (c) => PRIORITY_RANK[c.prioridade] ?? null, desc: true },
  prazo: { key: prazoKey, desc: false },
  criado_em: { key: (c) => c.criado_em ?? null, desc: true },
  atualizado_em: { key: (c) => c.atualizado_em ?? null, desc: true },
};

function compareKeys(a, b, desc) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (desc) return a < b ? 1 : -1;
  return a < b ? -1 : 1;
}

export function sortCards(cards, sort) {
  let compare;
  if (sort === 'titulo') {
    compare = (x, y) => (x.card.titulo || '').localeCompare(
      y.card.titulo || '', 'pt-BR', { sensitivity: 'base' }
    );
  } else if (SORT_KEYS[sort]) {
    const { key, desc } = SORT_KEYS[sort];
    compare = (x, y) => compareKeys(key(x.card), key(y.card), desc);
  } else {
    // 'manual' (or anything unknown): the board's own order, untouched.
    return cards;
  }
  return cards
    .map((card, index) => ({ card, index }))
    .sort((x, y) => compare(x, y) || x.index - y.index)
    .map((entry) => entry.card);
}

export function applyBoardView(cards, view, doneSlug = null, today = new Date()) {
  const filtered = isBoardViewFiltered(view)
    ? cards.filter((card) => matchesValue(view.prioridade, card.prioridade)
      && matchesValue(view.tipo, card.tipo)
      && matchesPrazo(view.prazo, card, doneSlug, today))
    : cards;
  return sortCards(filtered, view.sort);
}

// ---- remembered view ---------------------------------------------------------
// The filters/sort of the board are remembered per browser (same key and shape
// as the V2 board, so both layouts agree). Web storage can be missing or throw
// (private window, blocked site data): nothing here ever throws.

export const BOARD_VIEW_STORAGE_KEY = 'tasknexus.board.view';

const KNOWN_VALUES = {
  prioridade: new Set(['', FILTER_NONE, ...CARD_PRIORIDADES]),
  tipo: new Set(['', FILTER_NONE, ...CARD_TIPOS]),
  prazo: new Set(['', ...PRAZO_FILTER_OPTIONS.map((option) => option.value)]),
  sort: new Set(BOARD_SORT_OPTIONS.map((option) => option.value)),
};

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Only the known keys, only strings: a stale or hand-edited entry can never
// inject another shape.
export function readBoardView(storage = defaultStorage()) {
  const view = { ...DEFAULT_BOARD_VIEW };
  try {
    const saved = JSON.parse(storage?.getItem(BOARD_VIEW_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return view;
    for (const key of Object.keys(DEFAULT_BOARD_VIEW)) {
      // A value this build does not know (an old or hand-edited entry) would hide
      // every card behind a filter the selects cannot show: back to the default.
      if (typeof saved[key] === 'string' && KNOWN_VALUES[key].has(saved[key])) view[key] = saved[key];
    }
  } catch {
    return { ...DEFAULT_BOARD_VIEW };
  }
  return view;
}

export function writeBoardView(view, storage = defaultStorage()) {
  const known = {};
  for (const key of Object.keys(DEFAULT_BOARD_VIEW)) {
    known[key] = typeof view?.[key] === 'string' ? view[key] : DEFAULT_BOARD_VIEW[key];
  }
  try {
    storage?.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify(known));
  } catch {
    /* storage unavailable: the view just is not remembered */
  }
}
