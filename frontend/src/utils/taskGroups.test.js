// frontend/src/utils/taskGroups.test.js
// Focused unit coverage for `resolveClienteNome`'s name-resolution fallback
// (product decision, Bruno, "orphan card/task" session) — the full grouping
// behavior of `buildClienteTaskGroups` is already covered end-to-end through
// TarefasV2.test.jsx, so this file does not duplicate that suite.

import { describe, it, expect } from 'vitest';
import { resolveClienteNome } from './taskGroups.js';

const projects = [{ id: 'cliente', nome: 'Cliente', sub_projetos: [] }];

describe('resolveClienteNome', () => {
  it('resolves the display name of a known cliente', () => {
    expect(resolveClienteNome('cliente', projects)).toBe('Cliente');
  });

  // An unresolvable cliente (removed/unknown project, no entry in `projects`)
  // no longer falls back to the raw id — it used to return `clienteId`
  // verbatim, which callers displayed as if it were a real name. Callers now
  // decide how to handle the absence themselves (an inline tag just omits
  // itself; a structural label, like TarefasV2.jsx's group header, falls
  // back to the raw id locally, documented where it does).
  it('returns null for an unresolvable cliente instead of falling back to the raw id', () => {
    expect(resolveClienteNome('ghost', projects)).toBeNull();
  });

  it('returns null for a null/undefined clienteId', () => {
    expect(resolveClienteNome(null, projects)).toBeNull();
    expect(resolveClienteNome(undefined, projects)).toBeNull();
  });
});
