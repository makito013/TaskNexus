// frontend/src/features/artifacts/artifactModel.js
// Fase A (07-planejamento-artefatos.md, 7.2 e 7.5): regras PURAS da tela
// Artefatos — recorte por cliente/projeto, tipo, busca, ordem, grupos, textos
// do cartão e resolução de links. Sem React e sem fetch, para serem testadas
// isoladas (artifactModel.test.js).
//
// Por que filtrar aqui e não no backend (que aceita tipo/q/ordem/projeto_id,
// 7.10.3): a tela busca a lista do CLIENTE uma vez e recorta na hora. Os chips
// e a busca respondem sem esperar rede (no iPad, uma requisição por letra
// digitada pesa), e as regras são as mesmas do backend: busca sem acento e sem
// caixa, "recentes" pelo maior entre `updated_at` e o `mtime` atual, "nome"
// pelo título sem acento. O recorte por projeto usa o `isInScope` da Fase N —
// o MESMO das outras telas —, que cobre a subárvore de 3+ níveis por prefixo e
// a "Raiz" (só o próprio cliente, igualdade exata, que o `projeto_id` do
// backend não distingue).
import { isInScope, labelFor } from '../../utils/projectTree.js';
import { relativePathBelow } from '../../utils/projects.js';
import { clienteIdFromProjetoId } from '../../utils/clientes.js';
import { formatBytes, normalizeProjectPath, resolveRelativeTo, splitHref } from '../viewer/viewerPaths.js';

export const SCOPE_ARTEFATOS = 'artefatos';

export const KIND_LABEL = { markdown: 'MD', html: 'HTML', pdf: 'PDF' };

export const TIPO_CHIPS = [
  { id: 'todos', label: 'Todos' },
  { id: 'markdown', label: 'MD' },
  { id: 'html', label: 'HTML' },
  { id: 'pdf', label: 'PDF' },
];

export const ORDENS = [
  { id: 'recentes', label: 'Recentes' },
  { id: 'nome', label: 'Nome' },
];

/** Texto comparável: sem acento e sem caixa ("Relatório" casa "relatorio"). */
export function foldText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** "Quando" do artefato: o arquivo pode ter mudado no disco depois da última
 * publicação (7.2, "atualizado há X"), e o `mtime` atual vem na lista. */
export function artifactVersion(artifact) {
  const published = Number(artifact?.updated_at) || 0;
  const mtime = artifact?.exists !== false ? Number(artifact?.mtime) || 0 : 0;
  return Math.max(published, mtime);
}

/** Alterado no disco depois de publicado? (tolerância de 2 s: o agente salva e
 * publica quase no mesmo instante). */
export function changedAfterPublish(artifact) {
  if (artifact?.exists === false) return false;
  const mtime = Number(artifact?.mtime) || 0;
  const published = Number(artifact?.updated_at) || 0;
  return mtime > published + 2;
}

export function filterArtifacts(list, { clienteId = null, projetoId = null, tipo = 'todos', q = '' } = {}) {
  const needle = foldText(q).trim();
  return (list || []).filter((a) => {
    if (!isInScope(a.project_id, clienteId, projetoId)) return false;
    if (tipo && tipo !== 'todos' && a.kind !== tipo) return false;
    if (!needle) return true;
    return [a.title, a.path, a.description].some((field) => foldText(field).includes(needle));
  });
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }) : null;

function compareNames(a, b) {
  const left = foldText(a);
  const right = foldText(b);
  return collator ? collator.compare(left, right) : left.localeCompare(right);
}

export function sortArtifacts(list, ordem = 'recentes') {
  const copy = [...(list || [])];
  if (ordem === 'nome') {
    copy.sort((a, b) => compareNames(a.title, b.title) || compareNames(a.path, b.path));
  } else {
    copy.sort((a, b) => artifactVersion(b) - artifactVersion(a) || compareNames(a.title, b.title));
  }
  return copy;
}

/** Um grupo por projeto ("Todos os projetos"). A ordem dos grupos segue a da
 * lista já ordenada: em "Recentes", o projeto com o artefato mais novo vem
 * primeiro; em "Nome", os grupos ficam em ordem alfabética do rótulo. */
export function groupByProject(sorted, ordem = 'recentes', projects = []) {
  const groups = new Map();
  (sorted || []).forEach((a) => {
    if (!groups.has(a.project_id)) groups.set(a.project_id, []);
    groups.get(a.project_id).push(a);
  });
  const result = Array.from(groups, ([projectId, items]) => ({
    projectId,
    label: groupLabel(projectId, projects),
    items,
  }));
  if (ordem === 'nome') result.sort((a, b) => compareNames(a.label, b.label));
  return result;
}

/** Rótulo do grupo: "CLIENTE / PROJETO" (a caixa alta é do CSS). O cliente
 * pelo nome; o projeto pelo caminho abaixo do cliente (3+ níveis viram
 * "api-pagamentos / v2", mesma grafia da sidebar). Artefato preso direto no
 * cliente: só o nome do cliente. */
export function groupLabel(projectId, projects = []) {
  const clienteId = clienteIdFromProjetoId(projectId);
  const clienteNome = labelFor(clienteId, projects) || clienteId || projectId;
  if (!projectId || projectId === clienteId) return clienteNome;
  return `${clienteNome} / ${relativePathBelow(projectId, clienteId)}`;
}

/** Caminho mostrado no cartão: relativo ao projeto do artefato; numa grade de
 * um projeto com subprojetos, o subprojeto vem antes ("v2 / docs/x.md") para
 * dois `README.md` não parecerem o mesmo arquivo. */
export function displayPath(artifact, baseProjectId = null) {
  if (!baseProjectId || artifact.project_id === baseProjectId) return artifact.path;
  const below = relativePathBelow(artifact.project_id, baseProjectId);
  return below ? `${below} · ${artifact.path}` : artifact.path;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 d" e, depois de uma semana,
 * a data curta ("24 set"; com o ano se não for o atual). Segundos → texto. */
export function formatWhen(epochSeconds, now = Date.now()) {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return '';
  const diff = Math.max(0, Math.round(now / 1000 - epochSeconds));
  if (diff < 60) return 'agora';
  const minutes = Math.round(diff / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} d`;
  const date = new Date(epochSeconds * 1000);
  const label = `${date.getDate()} ${MESES[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/** Quem criou: o agente (claude, codex…) ou "você" (importou / salvou). */
export function authorLabel(artifact) {
  if (artifact?.created_by === 'user') return 'você';
  return artifact?.agent_label || 'agente';
}

/** Rodapé do cartão: "claude · há 2 h · 18 KB" (ou "atualizado há X" quando o
 * arquivo mudou no disco depois de publicado). Arquivo sumido: sem tamanho. */
export function footerText(artifact, now = Date.now()) {
  const parts = [authorLabel(artifact)];
  const when = formatWhen(artifactVersion(artifact), now);
  if (when) parts.push(changedAfterPublish(artifact) ? `atualizado ${when}` : when);
  if (artifact?.exists !== false && Number.isFinite(artifact?.size)) parts.push(formatBytes(artifact.size));
  return parts.join(' · ');
}

/** O artefato como aba do visualizador. `updated_at` da aba vira a VERSÃO do
 * arquivo (maior entre publicação e `mtime`): é a chave do cache de conteúdo
 * e o `?v=` do iframe/PDF — sem isso, um arquivo alterado no disco sem nova
 * publicação continuaria mostrando a versão velha no painel. */
export function toViewerItem(artifact) {
  return {
    ...artifact,
    published_at: artifact.updated_at,
    updated_at: artifactVersion(artifact),
  };
}

/** Link relativo dentro de um artefato → caminho no projeto (ou `null` se sair
 * da raiz). Mesmas regras do markdown do visualizador: `/x.md` é a raiz do
 * PROJETO; o resto é relativo à pasta do arquivo (`relativoA`). O `#hash`
 * (âncora ou `#L10`) volta separado. */
export function resolveArtifactLink(caminho, { relativoA } = {}) {
  const { hash } = splitHref(caminho);
  if (relativoA) {
    const path = resolveRelativeTo(relativoA, caminho);
    return path ? { path, hash } : null;
  }
  let { path } = splitHref(caminho);
  try { path = decodeURI(path); } catch { /* fica cru */ }
  const normalized = normalizeProjectPath(path.replace(/^\/+/, ''));
  return normalized ? { path: normalized, hash } : null;
}

/** Caminho ABSOLUTO do arquivo, para "Citar no chat": o agente da conversa
 * ativa pode estar em outro projeto, e um caminho relativo apontaria para o
 * lugar errado. Usa o `path` do projeto em /api/projects (no Windows vem com
 * "\\"; o separador acompanha). Sem o projeto na lista, fica o relativo. */
export function absolutePathFor(artifact, projects = []) {
  const project = (projects || []).find((p) => p.id === artifact?.project_id);
  const root = project?.path;
  if (!root) return artifact?.path || '';
  const windows = root.includes('\\') && !root.includes('/');
  const sep = windows ? '\\' : '/';
  const rel = windows ? artifact.path.split('/').join('\\') : artifact.path;
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel}`;
}
