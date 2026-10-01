// frontend/src/features/viewer/viewerPaths.test.js
import { describe, it, expect } from 'vitest';
import {
  basenameOf,
  encodePathForUrl,
  formatBytes,
  formatRelativeSeconds,
  isAnchorHref,
  isExternalHref,
  normalizeProjectPath,
  resolveRelativeTo,
  splitHref,
} from './viewerPaths.js';

describe('viewerPaths', () => {
  it('reconhece links externos e âncoras', () => {
    expect(isExternalHref('https://exemplo.com')).toBe(true);
    expect(isExternalHref('mailto:a@b.c')).toBe(true);
    expect(isExternalHref('//cdn.exemplo.com/x.js')).toBe(true);
    expect(isExternalHref('docs/plano.md')).toBe(false);
    expect(isExternalHref('../plano.md')).toBe(false);
    expect(isAnchorHref('#secao')).toBe(true);
    expect(isAnchorHref('plano.md#secao')).toBe(false);
  });

  it('normaliza . e .. e recusa sair da raiz', () => {
    expect(normalizeProjectPath('docs/./img/../a.png')).toBe('docs/a.png');
    expect(normalizeProjectPath('../fora.md')).toBeNull();
    expect(normalizeProjectPath('docs\\win\\a.md')).toBe('docs/win/a.md');
  });

  it('resolve recurso relativo a partir da pasta do arquivo', () => {
    expect(resolveRelativeTo('docs/relatorio.md', 'img/grafico.png')).toBe('docs/img/grafico.png');
    expect(resolveRelativeTo('docs/relatorio.md', '../logo.svg')).toBe('logo.svg');
    expect(resolveRelativeTo('docs/relatorio.md', '/assets/x.png')).toBe('assets/x.png');
    expect(resolveRelativeTo('README.md', 'a%20b.png')).toBe('a b.png');
    expect(resolveRelativeTo('README.md', 'https://x.com/a.png')).toBeNull();
    expect(resolveRelativeTo('README.md', '#topo')).toBeNull();
    expect(resolveRelativeTo('README.md', '../../fora.png')).toBeNull();
  });

  it('separa caminho, query e fragmento', () => {
    expect(splitHref('src/app.py#L10')).toEqual({ path: 'src/app.py', hash: 'L10' });
    expect(splitHref('a.md?x=1#s')).toEqual({ path: 'a.md', hash: 's' });
  });

  it('codifica cada segmento mantendo as barras', () => {
    expect(encodePathForUrl('docs/relatório final.html')).toBe('docs/relat%C3%B3rio%20final.html');
  });

  it('formata nome, tamanho e tempo', () => {
    expect(basenameOf('docs/plano.md')).toBe('plano.md');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(formatRelativeSeconds(1000, 1000 * 1000 + 10_000)).toBe('agora');
    expect(formatRelativeSeconds(1000, (1000 + 300) * 1000)).toBe('há 5 min');
  });
});
