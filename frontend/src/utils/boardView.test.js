import { describe, it, expect } from 'vitest';
import {
  applyBoardView,
  sortCards,
  isBoardViewFiltered,
  isBoardViewSorted,
  DEFAULT_BOARD_VIEW,
  FILTER_NONE,
} from './boardView.js';

const TODAY = new Date(2026, 10, 9);

function card(id, overrides = {}) {
  return {
    id,
    titulo: `Card ${id}`,
    status: 'a_fazer',
    prioridade: null,
    tipo: null,
    prazo: null,
    criado_em: id,
    atualizado_em: id,
    ...overrides,
  };
}

const ids = (list) => list.map((c) => c.id);
const view = (overrides) => ({ ...DEFAULT_BOARD_VIEW, ...overrides });

describe('boardView — filters', () => {
  const cards = [
    card(1, { prioridade: 'alta', tipo: 'bug', prazo: '2026-11-01' }),
    card(2, { prioridade: 'baixa', tipo: 'historia', prazo: '2026-12-01' }),
    card(3),
    card(4, { prioridade: 'alta', prazo: '2026-11-01', status: 'feito' }),
  ];

  it('returns the same array untouched with the default view', () => {
    expect(applyBoardView(cards, DEFAULT_BOARD_VIEW, 'feito', TODAY)).toBe(cards);
    expect(isBoardViewFiltered(DEFAULT_BOARD_VIEW)).toBe(false);
    expect(isBoardViewSorted(DEFAULT_BOARD_VIEW)).toBe(false);
  });

  it('filters by prioridade, including "sem prioridade"', () => {
    expect(ids(applyBoardView(cards, view({ prioridade: 'alta' }), 'feito', TODAY))).toEqual([1, 4]);
    expect(ids(applyBoardView(cards, view({ prioridade: FILTER_NONE }), 'feito', TODAY))).toEqual([3]);
  });

  it('filters by tipo, including "sem tipo"', () => {
    expect(ids(applyBoardView(cards, view({ tipo: 'historia' }), 'feito', TODAY))).toEqual([2]);
    expect(ids(applyBoardView(cards, view({ tipo: FILTER_NONE }), 'feito', TODAY))).toEqual([3, 4]);
  });

  it('filters by prazo; "atrasados" leaves done cards out', () => {
    expect(ids(applyBoardView(cards, view({ prazo: 'atrasado' }), 'feito', TODAY))).toEqual([1]);
    expect(ids(applyBoardView(cards, view({ prazo: 'sem_prazo' }), 'feito', TODAY))).toEqual([3]);
    expect(ids(applyBoardView(cards, view({ prazo: 'com_prazo' }), 'feito', TODAY))).toEqual([1, 2, 4]);
  });

  it('combines filters with AND', () => {
    const v = view({ prioridade: 'alta', prazo: 'atrasado' });
    expect(ids(applyBoardView(cards, v, 'feito', TODAY))).toEqual([1]);
  });
});

describe('boardView — sort', () => {
  it('prioridade: highest first, no prioridade last, ties keep the manual order', () => {
    const cards = [
      card(1),
      card(2, { prioridade: 'baixa' }),
      card(3, { prioridade: 'muito_alta' }),
      card(4, { prioridade: 'baixa' }),
    ];
    expect(ids(sortCards(cards, 'prioridade'))).toEqual([3, 2, 4, 1]);
  });

  it('prazo: earliest first, no prazo last', () => {
    const cards = [card(1), card(2, { prazo: '2026-12-01' }), card(3, { prazo: '2026-11-15' })];
    expect(ids(sortCards(cards, 'prazo'))).toEqual([3, 2, 1]);
  });

  it('criado_em / atualizado_em: most recent first', () => {
    const cards = [card(1), card(3), card(2)];
    expect(ids(sortCards(cards, 'criado_em'))).toEqual([3, 2, 1]);
    expect(ids(sortCards(cards, 'atualizado_em'))).toEqual([3, 2, 1]);
  });

  it('titulo: alphabetical, ignoring accents and case', () => {
    const cards = [card(1, { titulo: 'banana' }), card(2, { titulo: 'Ábaco' }), card(3, { titulo: 'carro' })];
    expect(ids(sortCards(cards, 'titulo'))).toEqual([2, 1, 3]);
  });

  it('manual or unknown sort keeps the array as is', () => {
    const cards = [card(2), card(1)];
    expect(sortCards(cards, 'manual')).toBe(cards);
    expect(sortCards(cards, 'xpto')).toBe(cards);
  });
});
