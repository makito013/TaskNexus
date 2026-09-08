// frontend/src/utils/projects.test.js
import { describe, it, expect } from 'vitest';
import {
  relativeProjectPath,
  compareProjectPaths,
  listSubProjectsForClient,
  truncatePathMeta,
} from './projects.js';

describe('relativeProjectPath', () => {
  it('returns the segments after the client id, joined with " / "', () => {
    expect(relativeProjectPath('podesubir/gateway/access-gateway-controlid-db', 'podesubir'))
      .toBe('gateway / access-gateway-controlid-db');
  });

  it('handles 2-segment ids (1 segment after the client)', () => {
    expect(relativeProjectPath('podesubir/gateway', 'podesubir')).toBe('gateway');
  });

  it('handles deeper ids (3 segments after the client)', () => {
    expect(relativeProjectPath('podesubir/principal/apps/podesubir-guardapp-rn', 'podesubir'))
      .toBe('principal / apps / podesubir-guardapp-rn');
  });

  it('returns an empty string for the root itself', () => {
    expect(relativeProjectPath('podesubir', 'podesubir')).toBe('');
  });

  it('falls back to the whole id when it does not start with clienteId', () => {
    expect(relativeProjectPath('outro/sub', 'podesubir')).toBe('outro/sub');
  });
});

describe('compareProjectPaths', () => {
  it('sorts a hyphenated sibling after its parent AND after the parent\'s own child', () => {
    // Reproduces the documented case: "-" (0x2D) sorts before "/" (0x2F) in
    // raw string comparison, which would wedge the hyphenated sibling
    // between the parent and its child. Segment-by-segment comparison fixes
    // this: the child must stay glued to its parent.
    const ids = [
      'podesubir/gateway/access-gateway-controlid',
      'podesubir/gateway/access-gateway-controlid-db',
      'podesubir/gateway/access-gateway-controlid/sub',
    ];
    const sorted = [...ids].sort(compareProjectPaths);
    expect(sorted).toEqual([
      'podesubir/gateway/access-gateway-controlid',
      'podesubir/gateway/access-gateway-controlid/sub',
      'podesubir/gateway/access-gateway-controlid-db',
    ]);
  });

  it('never returns 0 for a shared-prefix pair — the shorter (ancestor) path sorts first', () => {
    const parent = 'podesubir/gateway';
    const child = 'podesubir/gateway/sub';
    expect(compareProjectPaths(parent, child)).toBeLessThan(0);
    expect(compareProjectPaths(child, parent)).toBeGreaterThan(0);
    expect(compareProjectPaths(parent, parent)).not.toBe(undefined);
  });

  it('orders different-depth ids with no prefix relationship by their first differing segment', () => {
    const a = 'podesubir/gateway/deep/path';
    const b = 'podesubir/principal';
    expect(compareProjectPaths(a, b)).toBeLessThan(0);
    expect(compareProjectPaths(b, a)).toBeGreaterThan(0);
  });
});

describe('listSubProjectsForClient', () => {
  it('filters by prefix + slash — does not match a client-id-prefixed sibling without the slash', () => {
    const projects = [
      { id: 'podesubir/sub', elegivel: true },
      { id: 'podesubir2/sub', elegivel: true },
      { id: 'podesubir2', elegivel: true },
    ];
    const result = listSubProjectsForClient('podesubir', projects);
    expect(result.map((p) => p.id)).toEqual(['podesubir/sub']);
  });

  it('keeps only elegivel === true entries', () => {
    const projects = [
      { id: 'podesubir/gateway', elegivel: false },
      { id: 'podesubir/principal', elegivel: true },
    ];
    const result = listSubProjectsForClient('podesubir', projects);
    expect(result.map((p) => p.id)).toEqual(['podesubir/principal']);
  });

  it('sorts descendants in tree order and computes label/depth', () => {
    // The 7-id example from style-guide.md §8 (podesubir), minus the root
    // (never produced by this helper).
    //
    // NOTE: style-guide.md §8's table lists `principal` before
    // `portal_light`, but compareProjectPaths compares by plain code-unit
    // `<` per segment (its own documented rule) — at the first differing
    // character, 'o' (portal_light) < 'r' (principal), so portal_light
    // actually sorts first. This test follows the algorithm (the closed
    // spec copied verbatim from projectPaths.reference.js), not the
    // style-guide table, which has a transcription slip on this one pair.
    const projects = [
      { id: 'podesubir/principal/apps/podesubir-guardapp-rn', nome: 'podesubir-guardapp-rn', elegivel: true },
      { id: 'podesubir/portal_light', nome: 'portal_light', elegivel: true },
      { id: 'podesubir/gateway/access-gateway-controlid-db', nome: 'access-gateway-controlid-db', elegivel: true },
      { id: 'podesubir/principal', nome: 'principal', elegivel: true },
      { id: 'podesubir/gateway', nome: 'gateway', elegivel: true },
      { id: 'podesubir/principal/apps', nome: 'apps', elegivel: true },
    ];
    const result = listSubProjectsForClient('podesubir', projects);
    expect(result).toEqual([
      { id: 'podesubir/gateway', label: 'gateway', depth: 1 },
      { id: 'podesubir/gateway/access-gateway-controlid-db', label: 'gateway / access-gateway-controlid-db', depth: 2 },
      { id: 'podesubir/portal_light', label: 'portal_light', depth: 1 },
      { id: 'podesubir/principal', label: 'principal', depth: 1 },
      { id: 'podesubir/principal/apps', label: 'principal / apps', depth: 2 },
      { id: 'podesubir/principal/apps/podesubir-guardapp-rn', label: 'principal / apps / podesubir-guardapp-rn', depth: 3 },
    ]);
  });

  it('returns an empty array when there are no matching projects', () => {
    expect(listSubProjectsForClient('podesubir', [])).toEqual([]);
    expect(listSubProjectsForClient('podesubir', undefined)).toEqual([]);
  });
});

describe('truncatePathMeta', () => {
  it('leaves paths with 2 or fewer segments untouched', () => {
    expect(truncatePathMeta('gateway / access-gateway-controlid-db')).toBe('gateway / access-gateway-controlid-db');
  });

  it('truncates the head, keeping the last `budget` segments', () => {
    expect(truncatePathMeta('principal / apps / podesubir-guardapp-rn'))
      .toBe('… / apps / podesubir-guardapp-rn');
  });

  it('handles a single segment (no separator) without truncating', () => {
    expect(truncatePathMeta('gateway')).toBe('gateway');
  });
});
