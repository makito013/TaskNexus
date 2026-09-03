// frontend/src/utils/projects.test.js
import { describe, it, expect } from 'vitest';
import { resolveProjectLabel } from './projects.js';

const projetos = [
  { id: 'clienteA', nome: 'Cliente A' },
  { id: 'clienteA/site', nome: 'Site' },
];

describe('resolveProjectLabel', () => {
  it('resolves the project name when the id exists', () => {
    expect(resolveProjectLabel('clienteA/site', projetos)).toBe('Site');
  });

  it('falls back to the RAW id when the project does not resolve', () => {
    // This is the semantic that separates it from
    // useClienteProjetoFilter.resolveProjectName, which returns null here.
    // If someone consolidates the two, this assertion is what breaks.
    expect(resolveProjectLabel('clienteA/gone', projetos)).toBe('clienteA/gone');
  });

  it('falls back to the raw id when the project list is missing', () => {
    expect(resolveProjectLabel('clienteA', undefined)).toBe('clienteA');
    expect(resolveProjectLabel('clienteA', [])).toBe('clienteA');
  });
});
