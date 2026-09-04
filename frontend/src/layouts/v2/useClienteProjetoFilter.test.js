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
