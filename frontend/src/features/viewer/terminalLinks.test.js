// frontend/src/features/viewer/terminalLinks.test.js
// Fase V-2, passo 9 (6.5.6): caminhos clicáveis no terminal.
import { describe, it, expect, vi } from 'vitest';
import { createFilePathLinkProvider, findFilePathLinks, lineTextWithColumns } from './terminalLinks.js';

const paths = (text) => findFilePathLinks(text).map((l) => [l.path, l.line]);

describe('findFilePathLinks', () => {
  it('acha caminhos relativos, com linha, ./ ../ e absolutos', () => {
    expect(paths('Criei docs/plano.md e alterei src/app.py:42')).toEqual([
      ['docs/plano.md', null],
      ['src/app.py', 42],
    ]);
    expect(paths('veja ./README.md, ../lib/x.ts:10:5 e /home/u/proj/a.py')).toEqual([
      ['./README.md', null],
      ['../lib/x.ts', 10],
      ['/home/u/proj/a.py', null],
    ]);
  });

  it('nome solto só com extensão conhecida', () => {
    expect(paths('Edit(package.json) e README.md')).toEqual([['package.json', null], ['README.md', null]]);
    expect(paths('ver github.com, e.g. v1.2.3 ou 1.5x')).toEqual([]);
  });

  it('ignora URLs (são do addon de links web) e e-mails', () => {
    expect(paths('https://exemplo.com/docs/a.md e fulano@exemplo.com')).toEqual([]);
  });

  it('pontuação de fim de frase não entra no caminho', () => {
    expect(paths('Pronto: docs/relatorio.html.')).toEqual([['docs/relatorio.html', null]]);
    expect(paths('(src/app.py:7)')).toEqual([['src/app.py', 7]]);
  });

  it('índices cobrem o :linha', () => {
    const [link] = findFilePathLinks('  ⎿ src/app.py:42 ok');
    expect(link).toMatchObject({ text: 'src/app.py:42', start: 4, end: 17 });
  });
});

describe('lineTextWithColumns', () => {
  it('caractere largo ocupa duas colunas', () => {
    // "✅ a.md" — o emoji ocupa as colunas 0 e 1 (a 2ª tem largura 0).
    const cells = [
      { getChars: () => '✅', getWidth: () => 2 },
      { getChars: () => '', getWidth: () => 0 },
      ...' a.md   '.split('').map((ch) => ({ getChars: () => ch, getWidth: () => 1 })),
    ];
    const line = { length: cells.length, getCell: (x) => cells[x] };
    const { text, columns } = lineTextWithColumns(line);
    expect(text).toBe('✅ a.md');
    const [link] = findFilePathLinks(text);
    // índice 2 da string ("a") está na coluna 3 da tela
    expect(columns[link.start]).toBe(3);
  });
});

describe('createFilePathLinkProvider', () => {
  function fakeTerm(lines) {
    return {
      buffer: { active: { getLine: (y) => ({ translateToString: () => lines[y] }) } },
    };
  }

  it('entrega faixas 1-based com fim inclusivo e ativa com caminho e linha', () => {
    const onActivate = vi.fn();
    const provider = createFilePathLinkProvider(fakeTerm(['abra src/app.py:42']), onActivate);
    const callback = vi.fn();
    provider.provideLinks(1, callback);
    const [links] = callback.mock.calls[0];
    expect(links).toHaveLength(1);
    expect(links[0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 18, y: 1 } });
    links[0].activate(new MouseEvent('click'), links[0].text);
    expect(onActivate).toHaveBeenCalledWith('src/app.py', 42);
  });

  it('desligado (sem visualizador) não sublinha nada', () => {
    const provider = createFilePathLinkProvider(fakeTerm(['docs/a.md']), vi.fn(), () => false);
    const callback = vi.fn();
    provider.provideLinks(1, callback);
    expect(callback).toHaveBeenCalledWith(undefined);
  });
});
