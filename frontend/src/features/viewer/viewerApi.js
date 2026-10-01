// frontend/src/features/viewer/viewerApi.js
// Fase V-2: chamadas às rotas do visualizador (contratos reais na seção 6.10.3
// de docs/melhorias-tablet/06-planejamento-fase-v.md) e montagem de URLs.
//
// Por que existe a noção de ORIGEM (`source`) já agora: a Fase A (Artefatos,
// Parte 7, seção 7.3) reaproveita o mesmo painel com itens que vêm de outra
// tabela (`artifacts`) e são servidos por outras rotas
// (`/api/artifacts/{id}/content` e `/f/…`), com o MESMO formato de resposta
// (as duas saem de backend/app/file_serving.py). Os renderers só pedem
// `contentUrl(item)`/`fileUrl(item, …)`; quem sabe de onde o arquivo vem é
// este módulo. Para a Fase A basta o item chegar com `source: 'artifact'` e
// `artifact_id` — nenhum renderer muda.
import { encodePathForUrl } from './viewerPaths.js';

export const SOURCE_VIEWER = 'viewer';
export const SOURCE_ARTIFACT = 'artifact';

// Escopos: cada conjunto de abas tem um id. `session:<session_key>` são as abas
// de uma conversa (persistidas no backend, tabela viewer_items); a Fase A usa
// `artefatos` (abas só no front). A sessão vai inteira depois do prefixo — ela
// contém "/" e "::", e nada aqui precisa parti-la.
const SESSION_PREFIX = 'session:';

export function sessionScope(sessionKey) {
  return sessionKey ? `${SESSION_PREFIX}${sessionKey}` : null;
}

export function sessionKeyFromScope(scope) {
  return typeof scope === 'string' && scope.startsWith(SESSION_PREFIX)
    ? scope.slice(SESSION_PREFIX.length)
    : null;
}

/** Item como a tela usa: o objeto do backend + `source` + `id` (chave única,
 * qualquer que seja a origem). Não copia nada além disso: o resto do item
 * (`path`, `kind`, `line`, `updated_at`…) é o contrato do backend. */
export function normalizeItem(raw, source = SOURCE_VIEWER) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.source || source;
  const id = src === SOURCE_ARTIFACT ? raw.artifact_id ?? raw.id : raw.item_id ?? raw.id;
  if (!id) return null;
  return { ...raw, source: src, id };
}

function baseUrl(item) {
  const id = encodeURIComponent(item.id);
  return item.source === SOURCE_ARTIFACT ? `/api/artifacts/${id}` : `/api/viewer/${id}`;
}

export function contentUrl(item) {
  return `${baseUrl(item)}/content`;
}

/** URL do arquivo (ou de um vizinho do mesmo projeto, para imagens relativas
 * do markdown). `download` gera `?download=1` (Content-Disposition attachment,
 * que é o que faz o Safari do iPad salvar em Arquivos › Downloads).
 * `version` acrescenta `?v=<updated_at>`: o backend manda `no-store`, mas o
 * Safari reaproveita um <img>/<iframe> com a MESMA URL dentro da página — sem
 * isso, o agente reabrir um relatório alterado mostraria a versão velha. A
 * query não muda a resolução de `style.css` relativo (só o caminho conta). */
export function fileUrl(item, path = item.path, { download = false, version = null } = {}) {
  const params = [];
  if (download) params.push('download=1');
  if (version !== null && version !== undefined) params.push(`v=${encodeURIComponent(version)}`);
  return `${baseUrl(item)}/f/${encodePathForUrl(path)}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Erro com status HTTP e mensagem já legível (o backend devolve `error` nas
 * rotas de abrir e `detail` nas demais). */
export class ViewerApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ViewerApiError';
    this.status = status;
  }
}

async function readError(response, fallback) {
  try {
    const body = await response.json();
    const message = body?.error || (typeof body?.detail === 'string' ? body.detail : null);
    return new ViewerApiError(message || fallback, response.status);
  } catch {
    return new ViewerApiError(fallback, response.status);
  }
}

/** GET /content (markdown, código, metadados de binário). */
export async function fetchContent(item, { signal } = {}) {
  const response = await fetch(contentUrl(item), { signal });
  if (!response.ok) throw await readError(response, 'Não consegui carregar o arquivo.');
  return response.json();
}

// As rotas de sessão usam o session_key CRU na URL, sem encodeURIComponent —
// mesma convenção de services/api.js: ele tem "/" de subprojeto e o backend
// declara `{session_key:path}`.

export async function listSessionItems(sessionKey) {
  const response = await fetch(`/api/sessions/${sessionKey}/viewer`);
  if (!response.ok) throw await readError(response, 'Não consegui carregar as abas.');
  const body = await response.json();
  return (body?.items || []).map((raw) => normalizeItem(raw)).filter(Boolean);
}

/** POST — o usuário pediu para abrir (link num markdown, caminho no terminal).
 * `relativoA` é o `path` do arquivo onde o link estava (o backend resolve
 * `../x.md` a partir da pasta dele). Erros 400/403/404 viram ViewerApiError
 * com a mensagem do backend ("Arquivo não encontrado: …"). */
export async function openSessionPath(sessionKey, caminho, { linha, relativoA } = {}) {
  const body = { caminho };
  if (Number.isInteger(linha) && linha >= 1) body.linha = linha;
  if (relativoA) body.relativo_a = relativoA;
  const response = await fetch(`/api/sessions/${sessionKey}/viewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response, 'Não consegui abrir o arquivo.');
  const data = await response.json();
  if (!data?.success) throw new ViewerApiError(data?.error || 'Não consegui abrir o arquivo.', response.status);
  return {
    item: normalizeItem(data.item),
    reused: !!data.reused,
    evicted: Array.isArray(data.evicted) ? data.evicted : [],
  };
}

/** DELETE de uma aba. 404 = "já fechada" (6.10.2, item 15): conta como sucesso,
 * porque o efeito que o usuário quer — a aba sumir — já aconteceu. */
export async function closeSessionItem(sessionKey, itemId) {
  const response = await fetch(`/api/sessions/${sessionKey}/viewer/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
  if (response.status === 404) return { status: 'already_closed' };
  if (!response.ok) throw await readError(response, 'Não consegui fechar a aba.');
  return response.json();
}

export async function closeSessionItems(sessionKey) {
  const response = await fetch(`/api/sessions/${sessionKey}/viewer`, { method: 'DELETE' });
  if (!response.ok) throw await readError(response, 'Não consegui fechar as abas.');
  return response.json();
}
