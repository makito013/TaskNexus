// frontend/src/utils/projects.test.js
import { describe, it, expect } from 'vitest';
import {
  relativeProjectPath,
  relativePathBelow,
  compareProjectPaths,
  listSubProjectsForClient,
  listPrimaryProjectsForClient,
  listSubProjectsForPrimary,
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

describe('relativePathBelow', () => {
  it('returns the clean name for a direct child of the ancestor', () => {
    expect(relativePathBelow('podesubir/principal/apps', 'podesubir/principal')).toBe('apps');
  });

  it('joins deeper descendants with " / "', () => {
    expect(relativePathBelow('podesubir/principal/apps/podesubir-guardapp-rn', 'podesubir/principal'))
      .toBe('apps / podesubir-guardapp-rn');
  });

  it('works with a 1-segment ancestor, like relativeProjectPath', () => {
    expect(relativePathBelow('podesubir/principal', 'podesubir')).toBe('principal');
    expect(relativePathBelow('podesubir/gateway/db', 'podesubir')).toBe('gateway / db');
  });

  it('returns an empty string when the id IS the ancestor', () => {
    expect(relativePathBelow('podesubir/principal', 'podesubir/principal')).toBe('');
  });

  it('falls back to the whole id when the id is not a descendant', () => {
    expect(relativePathBelow('outro/sub', 'podesubir')).toBe('outro/sub');
  });

  it('does not treat a prefix-colliding sibling as a descendant', () => {
    // 'podesubir/principal2' shares the STRING prefix 'podesubir/principal'
    // but is a sibling, not a child — the `+ '/'` in the prefix test is what
    // catches it. Without it the label would come back as the nonsense '2'.
    expect(relativePathBelow('podesubir/principal2', 'podesubir/principal'))
      .toBe('podesubir/principal2');
  });
});

describe('listPrimaryProjectsForClient', () => {
  it('keeps only DIRECT children of the client (not deeper descendants, not the client itself)', () => {
    const projects = [
      { id: 'podesubir', elegivel: true },
      { id: 'podesubir/principal', elegivel: true },
      { id: 'podesubir/principal/apps', elegivel: true },
      { id: 'podesubir/gateway', elegivel: false },
    ];
    const result = listPrimaryProjectsForClient('podesubir', projects);
    expect(result.map((p) => p.id)).toEqual(['podesubir/gateway', 'podesubir/principal']);
  });

  it('does NOT filter by eligibility — grouping folders are a navigation step', () => {
    const projects = [
      { id: 'podesubir/gateway', elegivel: false },
      { id: 'podesubir/gateway/db', elegivel: true },
    ];
    const result = listPrimaryProjectsForClient('podesubir', projects);
    expect(result).toEqual([
      {
        id: 'podesubir/gateway',
        label: 'gateway',
        eligible: false,
        hasEligibleDescendants: true,
        depth: 1,
      },
    ]);
  });

  it('flags a grouping folder with no eligible descendant (dead end, state E)', () => {
    const projects = [
      { id: 'podesubir/vazio', elegivel: false },
      { id: 'podesubir/vazio/meio', elegivel: false },
    ];
    const [primary] = listPrimaryProjectsForClient('podesubir', projects);
    expect(primary.eligible).toBe(false);
    expect(primary.hasEligibleDescendants).toBe(false);
  });

  it('does not match a client-id-prefixed sibling without the slash', () => {
    const projects = [
      { id: 'podesubir/sub', elegivel: true },
      { id: 'podesubir2/sub', elegivel: true },
      { id: 'podesubir2', elegivel: true },
    ];
    expect(listPrimaryProjectsForClient('podesubir', projects).map((p) => p.id))
      .toEqual(['podesubir/sub']);
  });

  it('sorts siblings in tree order', () => {
    const projects = [
      { id: 'podesubir/principal', elegivel: true },
      { id: 'podesubir/gateway', elegivel: true },
      { id: 'podesubir/portal_light', elegivel: true },
    ];
    expect(listPrimaryProjectsForClient('podesubir', projects).map((p) => p.label))
      .toEqual(['gateway', 'portal_light', 'principal']);
  });

  it('returns an empty array for a client with no children / for missing input', () => {
    expect(listPrimaryProjectsForClient('podesubir', [])).toEqual([]);
    expect(listPrimaryProjectsForClient('podesubir', undefined)).toEqual([]);
  });
});

describe('listSubProjectsForPrimary', () => {
  it('keeps eligible descendants at ANY depth, flattening the path into the label', () => {
    const projects = [
      { id: 'podesubir/principal', elegivel: false },
      { id: 'podesubir/principal/apps', elegivel: false },
      { id: 'podesubir/principal/apps/podesubir-guardapp-rn', elegivel: true },
      { id: 'podesubir/principal/ymcy_backend', elegivel: true },
    ];
    const result = listSubProjectsForPrimary('podesubir/principal', projects);
    expect(result).toEqual([
      { id: 'podesubir/principal/apps/podesubir-guardapp-rn', label: 'apps / podesubir-guardapp-rn', depth: 2 },
      { id: 'podesubir/principal/ymcy_backend', label: 'ymcy_backend', depth: 1 },
    ]);
  });

  it('excludes the primary itself even when it is eligible', () => {
    const projects = [
      { id: 'podesubir/principal', elegivel: true },
      { id: 'podesubir/principal/sub', elegivel: true },
    ];
    expect(listSubProjectsForPrimary('podesubir/principal', projects).map((p) => p.id))
      .toEqual(['podesubir/principal/sub']);
  });

  it('does not treat a prefix-colliding sibling as a descendant', () => {
    const projects = [
      { id: 'podesubir/principal2', elegivel: true },
      { id: 'podesubir/principal2/sub', elegivel: true },
      { id: 'podesubir/principal/sub', elegivel: true },
    ];
    expect(listSubProjectsForPrimary('podesubir/principal', projects).map((p) => p.id))
      .toEqual(['podesubir/principal/sub']);
  });

  it('returns an empty array when there is no eligible descendant / for missing input', () => {
    const projects = [{ id: 'podesubir/principal/meio', elegivel: false }];
    expect(listSubProjectsForPrimary('podesubir/principal', projects)).toEqual([]);
    expect(listSubProjectsForPrimary('podesubir/principal', undefined)).toEqual([]);
  });
});

// The product-level guarantee the PO wrote down when the flat select was
// replaced by the 2-level cascade: EVERY eligible project that used to be
// reachable as a single <option> must still be reachable through some
// (primary, subproject) pair. A fixed 2-level cascade over an arbitrarily
// deep tree is exactly where that can silently stop being true.
describe('cascade reach invariant — every eligible descendant stays reachable', () => {
  // 5 levels deep, grouping folders and eligible projects interleaved,
  // including an eligible project nested under a non-eligible folder that is
  // itself nested under another non-eligible folder.
  const CLIENT_ID = 'podesubir';
  const TREE = [
    { id: 'podesubir', elegivel: false },                                  // client root: grouping
    { id: 'podesubir/principal', elegivel: false },                        // grouping primary
    { id: 'podesubir/principal/ymcy_backend', elegivel: true },
    { id: 'podesubir/principal/apps', elegivel: false },
    { id: 'podesubir/principal/apps/podesubir-guardapp-rn', elegivel: true },
    { id: 'podesubir/principal/apps/legacy', elegivel: false },
    { id: 'podesubir/principal/apps/legacy/v1', elegivel: true },
    { id: 'podesubir/gateway', elegivel: true },                           // eligible primary
    { id: 'podesubir/gateway/access-gateway-controlid', elegivel: false },
    { id: 'podesubir/gateway/access-gateway-controlid-db', elegivel: true },
    { id: 'podesubir/gateway/access-gateway-controlid/sub', elegivel: true },
    { id: 'podesubir/portal_light', elegivel: true },                      // eligible leaf primary
    { id: 'outro-cliente/coisa', elegivel: true },                         // another client
  ];

  it('every eligible descendant of the client is selectable via some (primary, subproject) pair', () => {
    const primaries = listPrimaryProjectsForClient(CLIENT_ID, TREE);
    const reachable = new Set();
    primaries.forEach((primary) => {
      // Option 1 of level 2 targets the primary itself, but only when the
      // primary is eligible ("Todo o {primário}") — a grouping folder is
      // never a valid submit target.
      if (primary.eligible) reachable.add(primary.id);
      listSubProjectsForPrimary(primary.id, TREE).forEach((sub) => reachable.add(sub.id));
    });

    const expectedEligible = TREE
      .filter((p) => p.id.startsWith(CLIENT_ID + '/') && p.elegivel === true)
      .map((p) => p.id);

    expect(expectedEligible.length).toBeGreaterThan(0);
    expectedEligible.forEach((id) => {
      expect(reachable.has(id)).toBe(true);
    });
  });

  it('never offers a project from another client, nor a non-eligible one as a submit target', () => {
    const primaries = listPrimaryProjectsForClient(CLIENT_ID, TREE);
    const targets = [];
    primaries.forEach((primary) => {
      if (primary.eligible) targets.push(primary.id);
      listSubProjectsForPrimary(primary.id, TREE).forEach((sub) => targets.push(sub.id));
    });
    const byId = Object.fromEntries(TREE.map((p) => [p.id, p]));
    targets.forEach((id) => {
      expect(id.startsWith(CLIENT_ID + '/')).toBe(true);
      expect(byId[id].elegivel).toBe(true);
    });
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
