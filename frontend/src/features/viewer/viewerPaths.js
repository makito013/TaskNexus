// frontend/src/features/viewer/viewerPaths.js
// Fase V-2 (docs/melhorias-tablet/06-planejamento-fase-v.md, 6.5.4): regras
// puras de caminho do visualizador — sem React, sem fetch — para poderem ser
// testadas isoladas e reaproveitadas pelo markdown, pelo terminal e, na Fase A,
// pela aba Artefatos.
//
// Convenção: todo caminho aqui é RELATIVO À RAIZ DO PROJETO, com "/" (o mesmo
// formato do `path` dos itens que o backend devolve). Resolver `..` é só para
// a tela montar URLs; quem decide o que pode ser lido continua sendo o
// backend (resolve_safe_path + denylist).

/** Link externo: abre no navegador, nunca no visualizador. */
export function isExternalHref(href) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(String(href || '').trim());
}

/** `#secao` sozinho: âncora dentro do próprio documento. */
export function isAnchorHref(href) {
  return String(href || '').trim().startsWith('#');
}

/** Normaliza `a/./b/../c` → `a/c`. Devolve `null` se o caminho sair da raiz
 * (mais `..` do que pastas): a tela não monta URL para fora do projeto. */
export function normalizeProjectPath(path) {
  const out = [];
  for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** Pasta de um caminho do projeto (`docs/a.md` → `docs`, `a.md` → ``). */
export function dirnameOf(path) {
  const clean = String(path || '').replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx === -1 ? '' : clean.slice(0, idx);
}

/** Separa `src/app.py#L10` em `{ path: 'src/app.py', hash: 'L10' }`. Também
 * descarta `?query` — num link de markdown ela não significa nada para um
 * arquivo local. */
export function splitHref(href) {
  const raw = String(href || '').trim();
  const hashIdx = raw.indexOf('#');
  const beforeHash = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : raw.slice(hashIdx + 1);
  const queryIdx = beforeHash.indexOf('?');
  const path = queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx);
  return { path, hash };
}

/** Caminho de um recurso relativo (imagem do markdown) a partir do arquivo onde
 * ele aparece. `/x.png` é a raiz do PROJETO (como o GitHub faz num README), não
 * a raiz do disco. Devolve `null` para externo, âncora, vazio ou fora da raiz. */
export function resolveRelativeTo(basePath, href) {
  if (!href || isExternalHref(href) || isAnchorHref(href)) return null;
  let { path } = splitHref(href);
  try {
    path = decodeURI(path);
  } catch {
    // %-escape inválido: segue com o texto cru, o backend responde 404.
  }
  if (!path) return null;
  if (path.startsWith('/')) return normalizeProjectPath(path);
  const dir = dirnameOf(basePath);
  return normalizeProjectPath(dir ? `${dir}/${path}` : path);
}

/** Codifica cada segmento de um caminho para a URL `/f/<caminho>`, mantendo as
 * barras: o navegador precisa delas para resolver `style.css` relativo dentro
 * do HTML aberto no iframe. */
export function encodePathForUrl(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/** Nome do arquivo (`docs/plano.md` → `plano.md`). */
export function basenameOf(path) {
  const clean = String(path || '').replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx === -1 ? clean : clean.slice(idx + 1);
}

// Sem lib de formatação no projeto (mesma decisão do AttachmentsMenu.jsx).
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`;
}

/** "agora", "há 5 min"… a partir de um timestamp em SEGUNDOS (formato do backend). */
export function formatRelativeSeconds(epochSeconds, now = Date.now()) {
  if (!Number.isFinite(epochSeconds)) return '';
  const diff = Math.max(0, Math.round(now / 1000 - epochSeconds));
  if (diff < 60) return 'agora';
  const minutes = Math.round(diff / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}
