// frontend/src/features/viewer/highlight.js
// Fase V-2 (06-planejamento-fase-v.md, 6.5.5): destaque de sintaxe com Shiki,
// carregado SOB DEMANDA. Nada daqui entra no bundle principal:
//  - o núcleo (`shiki/core`) e o motor de regex só são importados na primeira
//    vez que um bloco de código aparece no visualizador;
//  - cada linguagem e cada tema é um `import()` próprio (um chunk por
//    gramática), pedido só quando aparece.
//
// Motor JavaScript (e não o Oniguruma em WASM): o WASM do Oniguruma pesa ~600 KB
// e precisa ser baixado e compilado no iPad antes do primeiro destaque; o motor
// JS usa as RegExp do próprio Safari (com o flag `v` quando existe, iPadOS 17+,
// e regras ES2018 nos anteriores). `forgiving: true` faz uma regra de gramática
// que o motor não entenda ser ignorada em vez de derrubar o destaque inteiro —
// no pior caso sai um trecho sem cor, nunca um erro.
//
// Tema: `github-light`/`github-dark` conforme `data-theme` do <html>. Trocar
// de tema recarrega a página (AppearanceSwitch.jsx), então ler o atributo na
// hora do destaque basta.

// Mapa EXPLÍCITO (e não `import(\`shiki/langs/${id}.mjs\`)`): com o nome
// literal o Vite gera exatamente um chunk por linguagem listada, e uma
// linguagem desconhecida nunca vira uma requisição. Os ids são os que o
// backend devolve em `item.language` (file_access.language_for) mais os
// nomes comuns em cercas de código de markdown.
const LANG_LOADERS = {
  python: () => import('shiki/langs/python.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
};

const LANG_ALIASES = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps1: 'powershell',
  ps: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  svg: 'xml',
  dockerfile: 'docker',
  rs: 'rust',
  rb: 'ruby',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  cfg: 'ini',
  patch: 'diff',
};

const THEME_LOADERS = {
  'github-light': () => import('shiki/themes/github-light.mjs'),
  'github-dark': () => import('shiki/themes/github-dark.mjs'),
};

// Acima disso o destaque fica lento demais no iPad (a gramática roda linha a
// linha na thread principal) e o ganho é pequeno: mostra texto puro.
export const MAX_HIGHLIGHT_CHARS = 200_000;

/** Id canônico de linguagem que sabemos destacar, ou `null`. */
export function resolveLanguage(lang) {
  if (!lang) return null;
  const id = String(lang).trim().toLowerCase();
  const canonical = LANG_ALIASES[id] || id;
  return LANG_LOADERS[canonical] ? canonical : null;
}

export function currentShikiTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
    ? 'github-dark'
    : 'github-light';
}

let highlighterPromise = null;
const loadedLangs = new Map();
const loadedThemes = new Map();

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]).then(([core, engine]) => core.createHighlighterCore({
      themes: [],
      langs: [],
      engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
    })).catch((error) => {
      // Deixa tentar de novo depois (ex.: chunk que falhou por rede instável).
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

function ensureLoaded(cache, key, load) {
  if (!cache.has(key)) {
    cache.set(key, load().catch((error) => {
      cache.delete(key);
      throw error;
    }));
  }
  return cache.get(key);
}

/**
 * Tokens coloridos por linha (`[{ content, color, fontStyle }][]`), ou `null`
 * quando não há destaque para essa linguagem/tamanho ou o carregamento falhou.
 * Quem chama SEMPRE já mostrou o texto puro antes — o destaque é progressivo.
 */
export async function highlightToTokens(code, lang) {
  const language = resolveLanguage(lang);
  if (!language || typeof code !== 'string' || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const theme = currentShikiTheme();
  try {
    const highlighter = await getHighlighter();
    await Promise.all([
      ensureLoaded(loadedLangs, language, () => highlighter.loadLanguage(LANG_LOADERS[language]())),
      ensureLoaded(loadedThemes, theme, () => highlighter.loadTheme(THEME_LOADERS[theme]())),
    ]);
    return highlighter.codeToTokensBase(code, { lang: language, theme });
  } catch (error) {
    console.warn('Destaque de sintaxe indisponível', error);
    return null;
  }
}

// FontStyle do Shiki é um bitmask: 1 itálico, 2 negrito, 4 sublinhado.
export function tokenStyle(token) {
  const style = {};
  if (token.color) style.color = token.color;
  if (token.fontStyle & 1) style.fontStyle = 'italic';
  if (token.fontStyle & 2) style.fontWeight = 600;
  if (token.fontStyle & 4) style.textDecoration = 'underline';
  return style;
}

/** Preenche um <code> com spans coloridos (para os blocos do markdown, que são
 * HTML pronto e não componentes React). Usa `textContent`, nunca innerHTML: o
 * conteúdo vem do arquivo e não pode virar marcação. */
export function fillCodeElement(codeEl, lines) {
  const doc = codeEl.ownerDocument;
  const fragment = doc.createDocumentFragment();
  lines.forEach((line, index) => {
    for (const token of line) {
      const span = doc.createElement('span');
      span.textContent = token.content;
      Object.assign(span.style, tokenStyle(token));
      fragment.appendChild(span);
    }
    if (index < lines.length - 1) fragment.appendChild(doc.createTextNode('\n'));
  });
  codeEl.replaceChildren(fragment);
}
