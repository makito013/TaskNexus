// frontend/src/layouts/v2/useClienteProjetoFilter.test.js
// Pure unit tests (no render) for the helpers behind the Cliente/Projeto
// filter cascade. The hook itself is covered through BoardV2.test.jsx, which
// exercises it in its real consumer.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  collectSubtreeIds,
  resolveCardTags,
  resolveProjectName,
  useClienteProjetoFilter,
} from './useClienteProjetoFilter.js';

const projects = [
  { id: 'cliente', nome: 'Cliente', sub_projetos: ['cliente/projeto'] },
  { id: 'cliente/projeto', nome: 'Projeto', sub_projetos: ['cliente/projeto/sub'] },
  { id: 'cliente/projeto/sub', nome: 'Sub', sub_projetos: [] },
  { id: 'cliente2', nome: 'Cliente 2', sub_projetos: ['cliente2/x'] },
  { id: 'cliente2/x', nome: 'X', sub_projetos: [] },
];

describe('collectSubtreeIds', () => {
  it('returns the root itself for a leaf project (depth 1)', () => {
    expect(collectSubtreeIds('cliente/projeto/sub', projects)).toEqual(['cliente/projeto/sub']);
  });

  it('returns the root plus its direct child (depth 2)', () => {
    expect(collectSubtreeIds('cliente/projeto', projects)).toEqual([
      'cliente/projeto',
      'cliente/projeto/sub',
    ]);
  });

  it('returns the whole subtree, including grandchildren (depth 3)', () => {
    expect(collectSubtreeIds('cliente', projects)).toEqual([
      'cliente',
      'cliente/projeto',
      'cliente/projeto/sub',
    ]);
  });

  it('does not match a sibling whose id merely starts with the same characters', () => {
    expect(collectSubtreeIds('cliente', projects)).not.toContain('cliente2');
    expect(collectSubtreeIds('cliente', projects)).not.toContain('cliente2/x');
  });

  it('returns an empty array for a null root or an empty project list', () => {
    expect(collectSubtreeIds(null, projects)).toEqual([]);
    expect(collectSubtreeIds('cliente', [])).toEqual([]);
    expect(collectSubtreeIds('cliente', undefined)).toEqual([]);
  });

  it('returns an empty array for a root that is unknown to the project list', () => {
    expect(collectSubtreeIds('ghost', projects)).toEqual([]);
  });
});

describe('useClienteProjetoFilter — empty-subtree guard', () => {
  // `selectedProjectIds` is consumed by useCards, where an empty array means
  // "no filter at all — fetch EVERY project". So while a client (and here a
  // specific project) is selected, the hook must never hand back `[]`, even in
  // the window where `projects` has not resolved yet: it falls back to
  // `[effectiveClienteId]` instead. Dropping the guard (`return ids`) inverts
  // the very bug this round fixes — a project filter that suddenly matches
  // everything.
  it('never returns an empty selectedProjectIds while a project is picked but the project list has not loaded', () => {
    const { result } = renderHook(
      ({ projects }) => useClienteProjetoFilter(projects, 'cliente'),
      { initialProps: { projects: [] } }
    );

    act(() => { result.current.setSelectedProjetoId('cliente/projeto'); });

    expect(result.current.selectedProjectIds).toEqual(['cliente']);
    expect(result.current.selectedProjectIds.length).toBeGreaterThan(0);
  });
});

describe('resolveProjectName', () => {
  it('resolves the display name of a known project', () => {
    expect(resolveProjectName('cliente/projeto', projects)).toBe('Projeto');
  });

  // Product decision (Bruno, "orphan card/task" session): an unresolvable
  // project no longer falls back to the raw id — callers (resolveCardTags,
  // the tag markup in BoardV2.jsx/TarefasV2.jsx) treat `null` as "omit the
  // tag entirely", never a raw id standing in for a name.
  it('returns null for an unknown project instead of falling back to the raw id', () => {
    expect(resolveProjectName('ghost/x', projects)).toBeNull();
  });
});

describe('resolveCardTags', () => {
  it('yields both tags when the project differs from the client', () => {
    expect(resolveCardTags('cliente/projeto', projects)).toEqual({
      clienteId: 'cliente',
      clienteNome: 'Cliente',
      projetoNome: 'Projeto',
    });
  });

  it('yields both tags for a deep project, naming the deepest level', () => {
    expect(resolveCardTags('cliente/projeto/sub', projects)).toEqual({
      clienteId: 'cliente',
      clienteNome: 'Cliente',
      projetoNome: 'Sub',
    });
  });

  it('does not duplicate the tag when projetoId is the client itself', () => {
    expect(resolveCardTags('cliente', projects)).toEqual({
      clienteId: 'cliente',
      clienteNome: 'Cliente',
      projetoNome: null,
    });
  });

  it('yields no tags at all for a null/undefined projetoId, never an empty pill', () => {
    const empty = { clienteId: null, clienteNome: null, projetoNome: null };
    expect(resolveCardTags(null, projects)).toEqual(empty);
    expect(resolveCardTags(undefined, projects)).toEqual(empty);
    expect(resolveCardTags('', projects)).toEqual(empty);
  });

  // Product decision (Bruno, "orphan card/task" session): a card/task whose
  // project (or client) can't be resolved to a real name shows NO tag for
  // that level at all — never the raw id standing in for a name. `clienteId`
  // stays populated (it drives grouping, not display) but `clienteNome`/
  // `projetoNome` are `null`, and the `{clienteNome && <span>}` markup in
  // BoardV2.jsx/TarefasV2.jsx already omits the tag on `null`.
  it('yields no name tags when the projects list does not know the project (only the card itself is shown)', () => {
    expect(resolveCardTags('ghost/x', projects)).toEqual({
      clienteId: 'ghost',
      clienteNome: null,
      projetoNome: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Fase N (8.2.1 item 5): a barra parte do escopo da sidebar (cliente E
// projeto), refina só localmente e descarta o refinamento quando a sidebar
// muda.
// ---------------------------------------------------------------------------
describe('useClienteProjetoFilter — partindo do projeto da sidebar (Fase N)', () => {
  const tree = [
    { id: 'pode', nome: 'pode', sub_projetos: ['pode/api', 'pode/site'] },
    { id: 'pode/api', nome: 'api', sub_projetos: ['pode/api/v1', 'pode/api/v2'] },
    { id: 'pode/api/v1', nome: 'v1', sub_projetos: [] },
    { id: 'pode/api/v2', nome: 'v2', sub_projetos: ['pode/api/v2/x'] },
    { id: 'pode/api/v2/x', nome: 'x', sub_projetos: [] },
    { id: 'pode/site', nome: 'site', sub_projetos: [] },
    { id: 'outro', nome: 'outro', sub_projetos: [] },
  ];
  const renderFilter = (clienteId, projetoId) => renderHook(
    ({ c, p }) => useClienteProjetoFilter(tree, c, p),
    { initialProps: { c: clienteId, p: projetoId } }
  );

  it('sem projeto na sidebar: tudo como antes (Tier 2 vazio, opções = filhos diretos)', () => {
    const { result } = renderFilter('pode', null);
    expect(result.current.selectedProjetoId).toBeNull();
    expect(result.current.subProjetoIds).toEqual(['pode/api', 'pode/site']);
  });

  it('com projeto: o Tier 2 já vem preenchido e o filtro é a subárvore dele', () => {
    const { result } = renderFilter('pode', 'pode/api');
    expect(result.current.selectedProjetoId).toBe('pode/api');
    expect(result.current.selectedProjectIds).toEqual(['pode/api', 'pode/api/v1', 'pode/api/v2', 'pode/api/v2/x']);
  });

  it('com projeto: as opções trazem também os subprojetos dele (e os ancestrais), em ordem de árvore', () => {
    const { result } = renderFilter('pode', 'pode/api/v2');
    expect(result.current.subProjetoIds).toEqual([
      'pode/api',
      'pode/api/v2',
      'pode/api/v2/x',
      'pode/site',
    ]);
  });

  it('Raiz: a opção do próprio cliente vem primeiro e o filtro é só a pasta do cliente', () => {
    const { result } = renderFilter('pode', 'pode');
    expect(result.current.selectedProjetoId).toBe('pode');
    expect(result.current.subProjetoIds).toEqual(['pode', 'pode/api', 'pode/site']);
    expect(result.current.selectedProjectIds).toEqual(['pode']);
  });

  it('o projeto da sidebar vira opção mesmo antes de a lista de projetos chegar', () => {
    const { result } = renderHook(() => useClienteProjetoFilter([], 'pode', 'pode/api'));
    expect(result.current.subProjetoIds).toEqual(['pode/api']);
    expect(result.current.selectedProjectIds).toEqual(['pode']);
  });

  it('refinar na barra não muda o que veio da sidebar; mudar a sidebar descarta o refinamento', () => {
    const { result, rerender } = renderFilter('pode', 'pode/api');
    act(() => result.current.setSelectedProjetoId('pode/site'));
    expect(result.current.selectedProjetoId).toBe('pode/site');

    rerender({ c: 'pode', p: 'pode/api/v1' });
    expect(result.current.selectedProjetoId).toBe('pode/api/v1');

    act(() => result.current.setSelectedProjetoId(null));
    rerender({ c: 'pode', p: null });
    expect(result.current.selectedProjetoId).toBeNull();
    expect(result.current.selectedProjectIds).toEqual(['pode', 'pode/api', 'pode/api/v1', 'pode/api/v2', 'pode/api/v2/x', 'pode/site']);
  });

  it('em "Todos", o cliente escolhido na barra não sobrevive a uma troca da sidebar', () => {
    const { result, rerender } = renderFilter(null, null);
    act(() => result.current.setLocalClienteId('outro'));
    expect(result.current.effectiveClienteId).toBe('outro');

    rerender({ c: 'pode', p: null });
    rerender({ c: null, p: null });
    expect(result.current.localClienteId).toBeNull();
    expect(result.current.effectiveClienteId).toBeNull();
  });

  it('nenhum render filtra pelo refinamento velho depois de a sidebar mudar (o descarte é no mesmo render)', () => {
    const seen = [];
    const { result, rerender } = renderHook(
      ({ p }) => {
        const r = useClienteProjetoFilter(tree, 'pode', p);
        seen.push(r.selectedProjectIds);
        return r;
      },
      { initialProps: { p: 'pode/api' } }
    );
    act(() => result.current.setSelectedProjetoId('pode/site'));
    const from = seen.length;
    rerender({ p: 'pode/api/v1' });
    const after = seen.slice(from);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((ids) => !ids.includes('pode/site'))).toBe(true);
  });

  it('um projeto na sidebar sem cliente é ignorado ("Todos" nunca tem projeto)', () => {
    const { result } = renderFilter(null, 'pode/api');
    expect(result.current.selectedProjetoId).toBeNull();
    expect(result.current.selectedProjectIds).toEqual([]);
  });
});
