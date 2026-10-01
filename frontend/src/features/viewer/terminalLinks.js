// frontend/src/features/viewer/terminalLinks.js
// Fase V-2 (06-planejamento-fase-v.md, 6.5.6): caminhos de arquivo clicáveis
// no terminal. A parte pura (achar caminhos numa linha de texto e mapear para
// colunas do xterm) mora aqui para ser testada sem xterm; o TerminalPanel só
// registra o provider.
//
// O que conta como caminho (o que o claude/codex imprimem): `docs/plano.md`,
// `src/app.py:42`, `./README.md`, `../x/y.ts:10:5`, `/abs/dentro/do/projeto.md`
// e nomes soltos com extensão CONHECIDA (`README.md`, `package.json`).
// Fica de fora de propósito:
//  - URL (`https://…/a.md`): é do addon de links web, que abre no navegador;
//  - nome solto com extensão desconhecida (`github.com`, `e.g.`, `v1.2`): seria
//    sublinhado à toa e daria "Arquivo não encontrado" ao tocar;
//  - pasta (sem extensão): o visualizador abre arquivo, não pasta.
// O backend continua sendo quem decide se pode abrir (resolve_safe_path).

const KNOWN_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'json', 'jsonc', 'vue', 'svelte',
  'py', 'pyi', 'ipynb', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'swift', 'cs', 'c', 'h',
  'cpp', 'cc', 'hpp', 'lua', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sql', 'csv', 'tsv', 'log', 'xml',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'lock', 'diff', 'patch',
]);

// (?<![\w./:@-]) — não começa no meio de outra coisa: nem de uma palavra, nem
// de uma URL (`://`), nem de um e-mail.
// Grupo 1: o caminho (prefixo ./ ../ ou / opcional, pastas, nome.ext).
// Grupo 2: a extensão (começa com letra — "1.5" e "v1.2.3" não são arquivo).
// Grupo 3: a linha em `:42` (uma coluna `:42:7` é aceita e ignorada).
const PATH_PATTERN = /(?<![\w./:@-])((?:\.{1,2}\/|\/)?(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.([A-Za-z][A-Za-z0-9]{0,9}))(?::(\d+)(?::\d+)?)?(?![\w/])/g;

/**
 * Caminhos de arquivo numa linha de texto.
 * @returns {{ text: string, path: string, line: number|null, start: number, end: number }[]}
 *   `start`/`end` são índices na string (fim exclusivo) e cobrem o `:linha`.
 */
export function findFilePathLinks(text) {
  const links = [];
  if (!text) return links;
  PATH_PATTERN.lastIndex = 0;
  let match;
  while ((match = PATH_PATTERN.exec(text)) !== null) {
    const [whole, path, ext, lineStr] = match;
    const hasSlash = path.includes('/');
    if (!hasSlash && !KNOWN_EXTENSIONS.has(ext.toLowerCase())) continue;
    const line = lineStr ? Number(lineStr) : null;
    links.push({
      text: whole,
      path,
      line: line && line >= 1 ? line : null,
      start: match.index,
      end: match.index + whole.length,
    });
  }
  return links;
}

/**
 * Texto de uma linha do buffer do xterm + a coluna (0-based) de cada índice
 * da string. Necessário porque um caractere largo (emoji, CJK) ocupa DUAS
 * colunas: sem o mapa, o sublinhado de um caminho depois de um "✅" sairia
 * deslocado. Sem a API de células (dublês de teste), cai no texto puro com
 * coluna = índice.
 */
export function lineTextWithColumns(bufferLine) {
  if (!bufferLine) return { text: '', columns: [] };
  if (typeof bufferLine.getCell !== 'function') {
    const text = bufferLine.translateToString(true);
    return { text, columns: Array.from({ length: text.length + 1 }, (_, i) => i) };
  }
  let text = '';
  const columns = [];
  for (let x = 0; x < bufferLine.length; x += 1) {
    const cell = bufferLine.getCell(x);
    if (!cell) break;
    if (cell.getWidth() === 0) continue; // 2ª metade de um caractere largo
    const chars = cell.getChars() || ' ';
    for (let i = 0; i < chars.length; i += 1) columns.push(x);
    text += chars;
  }
  // Tira os espaços do fim (células vazias), como translateToString(true).
  const trimmed = text.replace(/\s+$/, '');
  columns.length = trimmed.length;
  columns.push(trimmed.length ? columns[trimmed.length - 1] + 1 : 0);
  return { text: trimmed, columns };
}

/**
 * O link provider do xterm (`term.registerLinkProvider`) para caminhos.
 * @param {import('@xterm/xterm').Terminal} term
 * @param {(path: string, line: number|null) => void} onActivate
 * @param {() => boolean} [isEnabled] sem visualizador (teste isolado), nada é sublinhado
 */
export function createFilePathLinkProvider(term, onActivate, isEnabled = () => true) {
  return {
    provideLinks(bufferLineNumber, callback) {
      if (!isEnabled()) {
        callback(undefined);
        return;
      }
      const bufferLine = term.buffer?.active?.getLine(bufferLineNumber - 1);
      const { text, columns } = lineTextWithColumns(bufferLine);
      const found = findFilePathLinks(text);
      if (found.length === 0) {
        callback(undefined);
        return;
      }
      callback(found.map((link) => ({
        // Faixa do xterm: colunas 1-based e fim INCLUSIVO.
        range: {
          start: { x: columns[link.start] + 1, y: bufferLineNumber },
          end: { x: columns[link.end - 1] + 1, y: bufferLineNumber },
        },
        text: link.text,
        decorations: { underline: true, pointerCursor: true },
        activate: () => onActivate(link.path, link.line),
      })));
    },
  };
}

/** Handler do addon de links web: abre numa aba do navegador, sem `opener`
 * (o site aberto não consegue mexer na janela do TaskNexus). */
export function openWebLink(event, uri) {
  if (event?.preventDefault) event.preventDefault();
  const win = window.open(uri, '_blank', 'noopener,noreferrer');
  if (win) win.opener = null;
}
