import { describe, it, expect } from 'vitest';
import { resolveProjectName } from './projectNames.js';

const projects = [
  { id: 'cliente', nome: 'Cliente' },
  { id: 'cliente/projeto', nome: 'Projeto' },
];

describe('resolveProjectName', () => {
  it('resolves the display name of a known project', () => {
    expect(resolveProjectName('cliente/projeto', projects)).toBe('Projeto');
  });

  it('returns null for an unknown project instead of falling back to the raw id', () => {
    expect(resolveProjectName('ghost/x', projects)).toBeNull();
  });

  it('returns null when the project list is missing', () => {
    expect(resolveProjectName('cliente', undefined)).toBeNull();
    expect(resolveProjectName('cliente', null)).toBeNull();
  });
});
