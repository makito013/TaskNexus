// frontend/src/utils/clientes.test.js
import { describe, it, expect } from 'vitest';
import {
  clienteIdFromProjetoId,
  projectHasSubprojects,
  shouldShowClienteBadge,
  resolveClienteBadgeLabel,
} from './clientes.js';

describe('clienteIdFromProjetoId', () => {
  it('projeto solto na raiz (sem "/"): cliente_id == o próprio id', () => {
    expect(clienteIdFromProjetoId('projeto_2')).toBe('projeto_2');
  });

  it('cliente-como-projeto sem subpasta: cliente_id == o próprio id', () => {
    expect(clienteIdFromProjetoId('podesubir')).toBe('podesubir');
  });

  it('cliente com múltiplos projetos (1 nível): cliente_id é o primeiro segmento', () => {
    expect(clienteIdFromProjetoId('cliente_projeto_1/subprojeto_1')).toBe('cliente_projeto_1');
  });

  it('múltiplos níveis de aninhamento: cliente_id continua o primeiro segmento', () => {
    expect(clienteIdFromProjetoId('cliente_projeto_1/subprojeto_1/sub')).toBe('cliente_projeto_1');
  });

  it('projeto_id null/undefined (achado do QA): não lança, cai em string vazia', () => {
    expect(clienteIdFromProjetoId(null)).toBe('');
    expect(clienteIdFromProjetoId(undefined)).toBe('');
  });
});

describe('projectHasSubprojects', () => {
  const projetos = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
    { id: 'podesubir', nome: 'Podesubir', sub_projetos: [] },
  ];

  it('retorna true quando o projeto tem sub_projetos não-vazio', () => {
    expect(projectHasSubprojects('cliente_projeto_1', projetos)).toBe(true);
  });

  it('retorna false quando sub_projetos é vazio (cliente-como-projeto)', () => {
    expect(projectHasSubprojects('podesubir', projetos)).toBe(false);
  });

  it('retorna false quando sub_projetos é vazio (projeto folha)', () => {
    expect(projectHasSubprojects('cliente_projeto_1/subprojeto_1', projetos)).toBe(false);
  });

  it('retorna false quando o projeto não é encontrado na lista', () => {
    expect(projectHasSubprojects('desconhecido', projetos)).toBe(false);
  });
});

describe('shouldShowClienteBadge', () => {
  // Hierarquia de 3 níveis reproduzindo o bug relatado pelo QA: um projeto
  // ("cliente-x/projeto-y") que TEM filhos, mas não é ele mesmo um id de
  // nível-cliente (contém "/").
  const projetos = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
    { id: 'podesubir', nome: 'Podesubir', sub_projetos: [] },
    {
      id: 'cliente-x/projeto-y',
      nome: 'Projeto Y',
      sub_projetos: ['cliente-x/projeto-y/sub-z'],
    },
    { id: 'cliente-x/projeto-y/sub-z', nome: 'Sub Z', sub_projetos: [] },
  ];

  it('retorna true para um id de nível-cliente com sub_projetos não-vazio (cliente-only ambíguo)', () => {
    expect(shouldShowClienteBadge('cliente_projeto_1', projetos)).toBe(true);
  });

  it('retorna false para cliente-como-projeto (nível-cliente, mas sem sub_projetos)', () => {
    expect(shouldShowClienteBadge('podesubir', projetos)).toBe(false);
  });

  it('retorna false para um projeto de nível 2+ que TEM sub_projetos, porque não é id de nível-cliente (bug do QA)', () => {
    expect(shouldShowClienteBadge('cliente-x/projeto-y', projetos)).toBe(false);
  });

  it('retorna false para um projeto folha (sem "/" no id, mas também sem sub_projetos)', () => {
    expect(shouldShowClienteBadge('cliente_projeto_1/subprojeto_1', projetos)).toBe(false);
  });

  it('retorna false quando o projeto não é encontrado na lista', () => {
    expect(shouldShowClienteBadge('desconhecido', projetos)).toBe(false);
  });
});

describe('resolveClienteBadgeLabel', () => {
  const projetos = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
    { id: 'podesubir', nome: 'Podesubir', sub_projetos: [] },
    {
      id: 'cliente-x/projeto-y',
      nome: 'Projeto Y',
      sub_projetos: ['cliente-x/projeto-y/sub-z'],
    },
    { id: 'cliente-x/projeto-y/sub-z', nome: 'Sub Z', sub_projetos: [] },
  ];

  describe('showAllClientes=false — preserva EXATAMENTE shouldShowClienteBadge (regressão)', () => {
    it.each([
      ['cliente_projeto_1', 'Cliente'],
      ['podesubir', null],
      ['cliente-x/projeto-y', null],
      ['cliente_projeto_1/subprojeto_1', null],
      ['desconhecido', null],
    ])('projetoId=%s -> %s', (projetoId, expected) => {
      const viaResolve = resolveClienteBadgeLabel(projetoId, projetos, false);
      const viaShouldShow = shouldShowClienteBadge(projetoId, projetos) ? 'Cliente' : null;
      expect(viaResolve).toBe(expected);
      // Trava a equivalência ponto-a-ponto com a função antiga, não só o
      // valor esperado hardcoded — qualquer divergência futura entre as duas
      // (mesmo que ambas "pareçam certas" isoladamente) quebra este teste.
      expect(viaResolve).toBe(viaShouldShow);
    });
  });

  describe('showAllClientes=true — TODO card ganha o nome do cliente', () => {
    it('card cliente-only (mesmo cenário de shouldShowClienteBadge=true) mostra o NOME, não a string fixa "Cliente"', () => {
      expect(resolveClienteBadgeLabel('cliente_projeto_1', projetos, true)).toBe('Cliente 1');
    });

    it('card cliente-como-projeto (sem sub_projetos — shouldShowClienteBadge=false) TAMBÉM mostra o nome em modo "Todos"', () => {
      expect(resolveClienteBadgeLabel('podesubir', projetos, true)).toBe('Podesubir');
    });

    it('card vinculado a um PROJETO específico (não cliente-only) mostra o nome do CLIENTE-PAI, não do próprio projeto', () => {
      // 'cliente_projeto_1/subprojeto_1' é um sub-projeto de 'cliente_projeto_1' — o card pertence
      // ao projeto Subprojeto 1, mas a badge em modo "Todos" identifica de qual
      // CLIENTE ele é (Cliente 1), não o nome do sub-projeto (Subprojeto 1).
      expect(resolveClienteBadgeLabel('cliente_projeto_1/subprojeto_1', projetos, true)).toBe('Cliente 1');
    });

    it('hierarquia de 3+ níveis: card em "cliente-x/projeto-y" também resolve pro cliente de topo', () => {
      expect(resolveClienteBadgeLabel('cliente-x/projeto-y', projetos, true)).toBe('cliente-x');
      // 'cliente-x' em si NÃO está na lista de projetos (só existe
      // 'cliente-x/projeto-y'), então cai no fallback do próprio id.
    });

    it('cliente não encontrado na lista: cai no fallback do próprio clienteId (nunca quebra)', () => {
      expect(resolveClienteBadgeLabel('fantasma/sub', projetos, true)).toBe('fantasma');
    });
  });
});
