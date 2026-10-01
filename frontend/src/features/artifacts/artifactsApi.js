// frontend/src/features/artifacts/artifactsApi.js
// Fase A (docs/melhorias-tablet/07-planejamento-artefatos.md, 7.10.3): chamadas
// às rotas de artefatos. Os contratos REAIS estão na 7.10.3 — vale ela, não o
// texto antigo da 7.4.3:
//  - erros das rotas JSON vêm como `{"success": false, "error": "…"}` com o
//    status HTTP (400/403/404);
//  - `POST /api/artifacts` responde 201 quando nasce e 200 quando já era
//    artefato (mesmo `artifact_id`);
//  - `DELETE` com 404 = "já removido" (conta como sucesso: o efeito que o
//    usuário quer, o cartão sumir, já aconteceu).
//
// `content` e `f/` (o arquivo em si) NÃO passam por aqui: quem monta essas URLs
// é o viewerApi (`contentUrl`/`fileUrl` com `source: 'artifact'`), o mesmo
// código das abas do chat.

export class ArtifactsApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ArtifactsApiError';
    this.status = status;
  }
}

async function readError(response, fallback) {
  try {
    const body = await response.json();
    const message = body?.error || (typeof body?.detail === 'string' ? body.detail : null);
    return new ArtifactsApiError(message || fallback, response.status);
  } catch {
    return new ArtifactsApiError(fallback, response.status);
  }
}

async function sendJson(url, method, body, fallback) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response, fallback);
  return { status: response.status, data: await response.json() };
}

/** GET /api/artifacts. A tela só manda `cliente_id` (ou nada, em "Todos"):
 * tipo, busca, ordem e o recorte por projeto são feitos na própria tela (ver
 * artifactModel.js) para os chips e a busca responderem na hora, sem uma
 * requisição por letra digitada no iPad. */
export async function listArtifacts({ clienteId = null, signal } = {}) {
  const params = new URLSearchParams();
  if (clienteId) params.set('cliente_id', clienteId);
  const query = params.toString();
  const response = await fetch(`/api/artifacts${query ? `?${query}` : ''}`, { signal });
  if (!response.ok) throw await readError(response, 'Não consegui carregar os artefatos.');
  const body = await response.json();
  return Array.isArray(body?.artifacts) ? body.artifacts : [];
}

/** Artefatos de um projeto e da subárvore dele (o backend filtra por prefixo). */
export async function listProjectArtifacts(projectId, { signal } = {}) {
  const params = new URLSearchParams({ projeto_id: projectId });
  const response = await fetch(`/api/artifacts?${params}`, { signal });
  if (!response.ok) throw await readError(response, 'Não consegui carregar os artefatos.');
  const body = await response.json();
  return Array.isArray(body?.artifacts) ? body.artifacts : [];
}

/** "Salvar em Artefatos". Devolve `{ artifact, created }` (201 = novo). */
export async function createArtifact(projectId, caminho, { titulo, descricao } = {}) {
  const body = { project_id: projectId, caminho };
  if (titulo) body.titulo = titulo;
  if (descricao) body.descricao = descricao;
  const { status, data } = await sendJson('/api/artifacts', 'POST', body, 'Não consegui salvar em Artefatos.');
  return { artifact: data, created: status === 201 };
}

export async function renameArtifact(artifactId, titulo) {
  const { data } = await sendJson(
    `/api/artifacts/${encodeURIComponent(artifactId)}`,
    'PATCH',
    { titulo },
    'Não consegui renomear o artefato.',
  );
  return data;
}

export async function removeArtifact(artifactId) {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
  if (response.status === 404) return { status: 'already_removed' };
  if (!response.ok) throw await readError(response, 'Não consegui remover da lista.');
  return response.json();
}

/** Candidatos do modal "Importar do projeto". O id do projeto vai cru na URL
 * (tem "/" de subprojeto e o backend declara `{project_id:path}`) — mesma
 * convenção de services/api.js. */
export async function listCandidates(projectId, { signal } = {}) {
  const response = await fetch(`/api/projects/${projectId}/artifact-candidates`, { signal });
  if (!response.ok) throw await readError(response, 'Não consegui listar os arquivos do projeto.');
  const body = await response.json();
  return {
    candidates: Array.isArray(body?.candidates) ? body.candidates : [],
    truncated: !!body?.truncated,
  };
}

export async function importArtifacts(projectId, caminhos) {
  const { data } = await sendJson(
    '/api/artifacts/import',
    'POST',
    { project_id: projectId, caminhos },
    'Não consegui importar os arquivos.',
  );
  return {
    created: Number.isFinite(data?.created) ? data.created : 0,
    artifacts: Array.isArray(data?.artifacts) ? data.artifacts : [],
    errors: Array.isArray(data?.errors) ? data.errors : [],
  };
}
