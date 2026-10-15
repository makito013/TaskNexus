// frontend/src/test/fixedPositioningScan.js
//
// Scanner shared by the `position: fixed` invariant guards
// (layouts/v2/fixedPositioningInvariant.test.js and
// layouts/v3/fixedPositioningInvariantV3.test.js). Extracted WITHOUT changing
// the list or the algorithm: the full rationale for the invariant lives in the
// header of the V2 test. The fixture suite that proves the detector catches the
// bad case still lives in the V2 test (and a mutation of the `Set` below turns
// it red).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Each entry is a declaration NAME (never a value -- see
// declaredPropertyNames), and appears in up to two spellings because the v2
// chain is styled both by CSS (`index.css`, `theme.css`, the `<style>` of
// `index.html`) and by JS style objects, where the same property becomes
// camelCase and the parser returns it lowercased: `backdrop-filter` and
// `backdropfilter` are the SAME prohibition written twice, not two properties.
// There is deliberately no prefix or camelCase derivation here: deriving the
// variants would give an impression of completeness that a `Set` of literals
// does not pretend to have, and one extra literal costs one line.
//
// KNOWN FALSE POSITIVE, and the right way out when it happens: a JS OBJECT KEY
// named `scale`, `rotate`, `translate` or `filter` in a chain file is flagged
// even though it is not a style declaration -- `{ scale: 1 }` and
// `{ filter: 'active' }` are indistinguishable from a declaration to a parser
// that only looks at "name before the colon". This class is NOT new: it has
// existed because of `filter` since the first version of the list;
// `translate`/`rotate`/`scale` only widen it. In this repo the risk is concrete
// and nameable: `getVisibleViewport` (utils/fabGeometry.js) documents
// `vv.scale !== 1` as a deliberate caveat and `src/test/fakeVisualViewport.js`
// already builds the fake with `scale` -- neither is in the chain today, but one
// of them could be. The right way out is to RENAME THE KEY (or destructure,
// which has no `:` and slips through), NEVER to add an exception to the list:
// a rename costs one line, an exception is a permanent hole in the only
// automatic guard that exists against this failure mode.
//
// PREFIXED CRITERION (not a cartesian product of 4 vendors x 4 properties --
// 18 literals out of the 32 possible): a combination is included when some
// engine ACTUALLY shipped it, because that is the one that shows up in snippets
// copied from Stack Overflow and the one an autoprefixer emits. Combinations
// that never existed are left out, so the list does not turn into a browser
// support table:
//  - `transform` for all 4 vendors -- all of them shipped (Safari/iOS,
//    Firefox < 16, IE 9, Opera Presto). By far the most likely to reappear;
//  - `filter` as `-webkit-` (Safari/iOS 6-9, still emitted by autoprefixer) and
//    as `-ms-`. `-ms-filter` is a special case and is included on purpose: it
//    is something ELSE (IE's proprietary `progid:DXImageTransform`), but it is a
//    real name, it is just as unwanted on a chain node, and nothing legitimate
//    in this repo (React 18 + Vite, iPad Safari target) has a reason to declare
//    it;
//  - `backdrop-filter` only as `-webkit-` -- the only prefix that ever existed,
//    and the most likely to be typed HERE, because Safari still requires the
//    prefixed form for the glass effect;
//  - `perspective` as `-webkit-` and `-moz-` -- prefixed 3D transforms only
//    existed in those two (IE 11 and Presto never had `-ms-`/`-o-`).
export const FORBIDDEN_PROPERTIES = new Set([
  // The original core: the properties that motivated the test to exist.
  'transform',
  'filter',
  'backdrop-filter',
  'backdropfilter',
  'will-change',
  'willchange',
  'contain',

  // Extension: same containing-block effect, different names.
  //  - `perspective` (!= `none`) creates a containing block by itself, without
  //    `transform`;
  //  - `content-visibility` (`auto`/`hidden`) IMPLIES paint containment, and
  //    paint containment is what creates the containing block -- the name does
  //    not look related to positioning at all, which is exactly why it would slip
  //    through;
  //  - `container-type` (!= `normal`) implies containment through the same path.
  //    It is the most dangerous of the new ones in terms of likelihood: container
  //    queries are the idiomatic 2025 answer to "this panel must react to its own
  //    width", exactly the problem the terminal and the shortcuts panel have;
  //  - `translate`/`rotate`/`scale` are the individual transform properties
  //    (CSS Transforms 2), a modern shortcut for what `transform` did -- whoever
  //    uses them is deliberately avoiding writing `transform` and would escape
  //    the old list because of it.
  'perspective',
  'content-visibility',
  'contentvisibility',
  'container-type',
  'containertype',
  'translate',
  'rotate',
  'scale',

  // Prefixed -- see the PREFIXED CRITERION above. Always in pairs: the hyphenated
  // CSS spelling and the same in camelCase of a JS object, which the parser
  // returns lowercased (`WebkitTransform` -> `webkittransform`,
  // `msTransform` -> `mstransform`).
  '-webkit-transform',
  'webkittransform',
  '-moz-transform',
  'moztransform',
  '-ms-transform',
  'mstransform',
  '-o-transform',
  'otransform',
  '-webkit-filter',
  'webkitfilter',
  '-ms-filter',
  'msfilter',
  '-webkit-backdrop-filter',
  'webkitbackdropfilter',
  '-webkit-perspective',
  'webkitperspective',
  '-moz-perspective',
  'mozperspective',
]);

/**
 * Strips block, line and HTML comments, so the prose does not report itself.
 *
 * The `<!-- -->` rule was added together with `index.html` in the list above,
 * and against TODAY's `index.html` it is PREVENTIVE -- stated plainly, because
 * the previous sentence of this paragraph claimed the opposite and a comment
 * that lies is the costliest defect in this repo. The two multi-line comments
 * the file has today (the PWA manifest one and the pre-JS background one) have
 * no forbidden word at the start of any line, so deleting this rule does NOT
 * change the verdict on that file.
 *
 * What it prevents is the next comment: a multi-line `<!-- -->` with the word at
 * the start of a line (`<!--\n  transform: never here\n-->`) would fail the test
 * REPORTING AN OFFENDER THAT DOES NOT EXIST. The likelihood is not academic --
 * `index.html` is made of explanatory prose, and the reason it is in the list is
 * that it styles two chain nodes, exactly the subject someone will write
 * "do not declare X here" about.
 *
 * Whoever measures the need for this line by deleting it: the red comes from the
 * case `reads declarations inside <style> and ignores them inside HTML comments`,
 * which uses a FIXTURE precisely so it does not depend on the real file still
 * having the right comment shape -- and not from the `it.each` over
 * `index.html`, which stays green. That is design, not a gap.
 *
 * (A ONE-line HTML comment escapes through another path, and by accident: the
 * `<!--` sticks to the name and the character guard rejects the candidate. It is
 * luck, not coverage -- it does not serve as proof for this rule.)
 *
 * HTML first, on purpose: the content of a `<!-- -->` is removed entirely before
 * the `/* *\/` and `//` rules, so nothing inside it can unbalance the next two.
 */
export function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

/**
 * Removes whole `@keyframes ... { ... }` blocks (including the inner braces of
 * the steps). `transform` inside a keyframe is legitimate: it is never a
 * declaration applied to a chain node by itself.
 */
export function stripKeyframes(source) {
  let out = '';
  let index = 0;
  for (;;) {
    const at = source.indexOf('@keyframes', index);
    if (at === -1) {
      out += source.slice(index);
      return out;
    }
    out += source.slice(index, at);
    const open = source.indexOf('{', at);
    if (open === -1) return out;
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    index = cursor + 1;
  }
}

/**
 * Property names of the file's declarations.
 *
 * Serves CSS and JS style objects with the same algorithm: split on `; , { } \n`
 * and, from each piece, take what comes before the first `:`. A declaration
 * value never survives that split as a name -- in
 * `transition: opacity 150ms, transform 120ms` the piece ` transform 120ms` has
 * no `:`, so it is not a property name. And in `text-transform:` the whole name
 * is `text-transform`, which is not in the list.
 */
export function declaredPropertyNames(source) {
  const clean = stripKeyframes(stripComments(source));
  const names = [];
  for (const chunk of clean.split(/[;,{}\n]/)) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const name = chunk.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
    if (!name || /[\s()[\]=<>?!&|+*/]/.test(name)) continue;
    names.push(name.toLowerCase());
  }
  return names;
}

/**
 * Reads a chain file relative to the calling test's `import.meta.url`.
 */
export function readSourceRelativeTo(importMetaUrl, relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, importMetaUrl)), 'utf8');
}
