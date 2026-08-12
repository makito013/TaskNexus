// frontend/src/pwaManifest.test.js
// Phase 2 (PWA installability plan): validates the static
// frontend/public/manifest.webmanifest file itself — not a hook or
// component, so this reads the file straight off disk with `fs` instead of
// going through fetch/jsdom. Package.json has "type": "module", so there is
// no __dirname here; paths are resolved from import.meta.url instead.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.webmanifest');

function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw);
}

describe('manifest.webmanifest', () => {
  it('is valid, parseable JSON', () => {
    expect(() => readManifest()).not.toThrow();
  });

  it('declares standalone display mode', () => {
    const manifest = readManifest();
    expect(manifest.display).toBe('standalone');
  });

  it('lists at least two icons', () => {
    const manifest = readManifest();
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a 192x192 icon entry', () => {
    const manifest = readManifest();
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  });

  it('includes a 512x512 icon entry', () => {
    const manifest = readManifest();
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  });

  it('includes at least one maskable icon', () => {
    const manifest = readManifest();
    expect(manifest.icons.some((icon) => (icon.purpose || '').includes('maskable'))).toBe(true);
  });

  it('references icon files that actually exist on disk', () => {
    const manifest = readManifest();
    for (const icon of manifest.icons) {
      // icon.src is root-absolute (e.g. "/icons/icon-192.png"), matching how
      // the browser resolves it against the app's origin — strip the
      // leading "/" and join against public/, the directory that becomes
      // the origin's root after `vite build`.
      const relativePath = icon.src.replace(/^\//, '');
      const absolutePath = path.join(PUBLIC_DIR, relativePath);
      expect(fs.existsSync(absolutePath), `missing icon file: ${icon.src}`).toBe(true);
    }
  });
});
