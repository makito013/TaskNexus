// frontend/src/features/artifacts/artifactModel.test.js
// Fase A (7.7, "Frontend"): regras puras da tela Artefatos — recorte por
// cliente/projeto (inclusive 3 níveis, que já quebrou no Board), tipo, busca
// sem acento, ordem, grupos, textos do cartão e links relativos.
import { describe, it, expect } from 'vitest';
import {
  absolutePathFor,
  artifactVersion,
  changedAfterPublish,
  displayPath,
  filterArtifacts,
  footerText,
  formatWhen,
  groupByProject,
  groupLabel,
  resolveArtifactLink,
  sortArtifacts,
  toViewerItem,
} from './artifactModel.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 1 out 2026, 12:00 UTC
const T = NOW / 1000;

function art(id, extra = {}) {
  return {
    artifact_id: id,
    project_id: 'podesubir/site',
    cliente_id: 'podesubir',
    path: `docs/${id}.md`,
    kind: 'markdown',
    title: id,
    description: null,
    excerpt: null,
    size: 2048,
    mtime: T - 7200,
    exists: true,
    created_by: 'agent',
    agent_label: 'claude',
    created_at: T - 7200,
    updated_at: T - 7200,
    ...extra,
  };
}

const PROJECTS = [
  { id: 'podesubir', nome: 'Pode Subir' },
  { id: 'podesubir/site', nome: 'site' },
  { id: 'podesubir/api', nome: 'api' },
  { id: 'podesubir/api/v2', nome: 'v2' },
  { id: 'outro', nome: 'Outro Cliente', path: 'C:\\Projetos\\outro' },
];

describe('filterArtifacts', () => {
  const list = [
    art('a', { project_id: 'podesubir/site' }),
    art('b', { project_id: 'podesubir/api', kind: 'html', path: 'r.html', title: 'Relatório' }),
    art('c', { project_id: 'podesubir/api/v2', kind: 'pdf', path: 'p.pdf', description: 'Proposta comercial' }),
    art('d', { project_id: 'podesubir', cliente_id: 'podesubir' }),
    art('e', { project_id: 'outro', cliente_id: 'outro' }),
  ];
  const ids = (r) => r.map((a) => a.artifact_id);

  it('"Todos" passa tudo; cliente passa a subárvore inteira dele', () => {
    expect(ids(filterArtifacts(list, {}))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(filterArtifacts(list, { clienteId: 'podesubir' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('projeto inclui os subprojetos de 3 níveis; Raiz é só o próprio cliente', () => {
    expect(ids(filterArtifacts(list, { clienteId: 'podesubir', projetoId: 'podesubir/api' }))).toEqual(['b', 'c']);
    expect(ids(filterArtifacts(list, { clienteId: 'podesubir', projetoId: 'podesubir/api/v2' }))).toEqual(['c']);
    expect(ids(filterArtifacts(list, { clienteId: 'podesubir', projetoId: 'podesubir' }))).toEqual(['d']);
  });

  it('tipo filtra pelo kind; busca ignora acento e caixa em título, caminho e descrição', () => {
    expect(ids(filterArtifacts(list, { tipo: 'html' }))).toEqual(['b']);
    expect(ids(filterArtifacts(list, { tipo: 'pdf' }))).toEqual(['c']);
    expect(ids(filterArtifacts(list, { q: 'relatorio' }))).toEqual(['b']);
    expect(ids(filterArtifacts(list, { q: 'PROPOSTA' }))).toEqual(['c']);
    expect(ids(filterArtifacts(list, { q: 'p.pdf' }))).toEqual(['c']);
    expect(ids(filterArtifacts(list, { q: '   ' }))).toHaveLength(5);
  });
});

describe('ordem e grupos', () => {
  it('recentes usa o maior entre updated_at e mtime; nome ignora acento', () => {
    const list = [
      art('velho', { updated_at: T - 9000, mtime: T - 9000, title: 'Ábaco' }),
      art('editado', { updated_at: T - 9999, mtime: T - 60, title: 'zebra' }),
      art('novo', { updated_at: T - 600, mtime: T - 600, title: 'banana' }),
    ];
    expect(sortArtifacts(list, 'recentes').map((a) => a.artifact_id)).toEqual(['editado', 'novo', 'velho']);
    expect(sortArtifacts(list, 'nome').map((a) => a.title)).toEqual(['Ábaco', 'banana', 'zebra']);
  });

  it('arquivo sumido não usa o mtime para "recentes"', () => {
    const gone = art('x', { exists: false, updated_at: T - 5000, mtime: T });
    expect(artifactVersion(gone)).toBe(T - 5000);
    expect(changedAfterPublish(gone)).toBe(false);
  });

  it('agrupa por projeto na ordem da lista (recentes) ou do rótulo (nome)', () => {
    const sorted = [
      art('1', { project_id: 'podesubir/site' }),
      art('2', { project_id: 'podesubir/api/v2' }),
      art('3', { project_id: 'podesubir/site' }),
    ];
    const groups = groupByProject(sorted, 'recentes', PROJECTS);
    expect(groups.map((g) => g.projectId)).toEqual(['podesubir/site', 'podesubir/api/v2']);
    expect(groups[0].items.map((a) => a.artifact_id)).toEqual(['1', '3']);
    expect(groups[1].label).toBe('Pode Subir / api / v2');
    expect(groupByProject(sorted, 'nome', PROJECTS).map((g) => g.projectId)).toEqual(['podesubir/api/v2', 'podesubir/site']);
  });

  it('rótulo do grupo: cliente-como-projeto mostra só o cliente', () => {
    expect(groupLabel('podesubir', PROJECTS)).toBe('Pode Subir');
    expect(groupLabel('podesubir/site', PROJECTS)).toBe('Pode Subir / site');
    expect(groupLabel('desconhecido/x', PROJECTS)).toBe('desconhecido / x');
  });
});

describe('textos do cartão', () => {
  it('rodapé: quem · quando · tamanho', () => {
    expect(footerText(art('a'), NOW)).toBe('claude · há 2 h · 2,0 KB');
    expect(footerText(art('a', { created_by: 'user', agent_label: null }), NOW)).toBe('você · há 2 h · 2,0 KB');
    expect(footerText(art('a', { exists: false }), NOW)).toBe('claude · há 2 h');
  });

  it('"atualizado há X" quando o arquivo mudou no disco depois de publicado', () => {
    expect(footerText(art('a', { updated_at: T - 86400 * 3, mtime: T - 300 }), NOW)).toBe('claude · atualizado há 5 min · 2,0 KB');
  });

  it('quando: relativo até uma semana, depois a data curta', () => {
    expect(formatWhen(T - 30, NOW)).toBe('agora');
    expect(formatWhen(T - 86400, NOW)).toBe('ontem');
    expect(formatWhen(T - 86400 * 3, NOW)).toBe('há 3 d');
    expect(formatWhen(Date.UTC(2026, 8, 20, 12) / 1000, NOW)).toBe('20 set');
    expect(formatWhen(Date.UTC(2025, 0, 5, 12) / 1000, NOW)).toBe('5 jan 2025');
  });

  it('caminho na grade de um projeto com subprojetos mostra o subprojeto', () => {
    const a = art('a', { project_id: 'podesubir/api/v2', path: 'README.md' });
    expect(displayPath(a, 'podesubir/api')).toBe('v2 · README.md');
    expect(displayPath(a, 'podesubir/api/v2')).toBe('README.md');
    expect(displayPath(a, null)).toBe('README.md');
  });

  it('aba do visualizador: updated_at vira a versão do arquivo', () => {
    const item = toViewerItem(art('a', { updated_at: 10, mtime: 50 }));
    expect(item.updated_at).toBe(50);
    expect(item.published_at).toBe(10);
  });
});

describe('links e caminhos', () => {
  it('link relativo resolve a partir da pasta do artefato; /x é a raiz do projeto', () => {
    expect(resolveArtifactLink('plano.md', { relativoA: 'docs/a.md' })).toEqual({ path: 'docs/plano.md', hash: '' });
    expect(resolveArtifactLink('../src/app.py#L10', { relativoA: 'docs/a.md' })).toEqual({ path: 'src/app.py', hash: 'L10' });
    expect(resolveArtifactLink('/README.md', {})).toEqual({ path: 'README.md', hash: '' });
    expect(resolveArtifactLink('../../fora.md', { relativoA: 'docs/a.md' })).toBeNull();
  });

  it('caminho absoluto para "Citar no chat" (Windows com contrabarra)', () => {
    expect(absolutePathFor(art('a', { project_id: 'outro', path: 'docs/x.md' }), PROJECTS)).toBe('C:\\Projetos\\outro\\docs\\x.md');
    expect(absolutePathFor(art('a', { path: 'docs/x.md' }), [{ id: 'podesubir/site', path: '/home/b/podesubir/site/' }])).toBe('/home/b/podesubir/site/docs/x.md');
    expect(absolutePathFor(art('a', { path: 'docs/x.md' }), [])).toBe('docs/x.md');
  });
});
