// frontend/src/hooks/useNavScope.test.js
// Fase N, passo 2: escopo global cliente/projeto da sidebar v2 — transições do
// drill-down, persistência em localStorage e validação contra `projects`
// (seções 8.3.2 e 8.4 da Parte 8).

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  NAV_SCOPE_STORAGE_KEY,
  TODOS_SCOPE,
  sanitizeNavScope,
  useNavScope,
} from './useNavScope.js';

const projects = [
  { id: 'podesubir', nome: 'podesubir', elegivel: true },
  { id: 'podesubir/site-institucional', nome: 'site-institucional', elegivel: true },
  { id: 'podesubir/api-pagamentos', nome: 'api-pagamentos', elegivel: false },
  { id: 'podesubir/api-pagamentos/v1', nome: 'v1', elegivel: true },
  { id: 'podesubir/api-pagamentos/v2', nome: 'v2', elegivel: true },
  { id: 'interno', nome: 'interno', elegivel: true },
];

const stored = () => JSON.parse(localStorage.getItem(NAV_SCOPE_STORAGE_KEY));
const scopeOf = (r) => ({
  clienteId: r.current.clienteId,
  projetoId: r.current.projetoId,
  level: r.current.level,
  parentId: r.current.parentId,
});

beforeEach(() => localStorage.clear());

describe('useNavScope — estado inicial', () => {
  it('sem nada salvo e sem cliente inicial: "Todos", nível Clientes', () => {
    const { result } = renderHook(() => useNavScope(projects));
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);
  });

  it('sem nada salvo: parte do cliente do chat ativo (initialClienteId), ainda no nível Clientes', () => {
    const { result } = renderHook(() => useNavScope(projects, { initialClienteId: 'podesubir' }));
    expect(scopeOf(result)).toEqual({ clienteId: 'podesubir', projetoId: null, level: 'clientes', parentId: null });
  });

  it('o que está salvo vence o cliente do chat ativo', () => {
    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify({
      clienteId: 'podesubir', projetoId: 'podesubir/site-institucional', level: 'projetos', parentId: 'podesubir',
    }));
    const { result } = renderHook(() => useNavScope(projects, { initialClienteId: 'interno' }));
    expect(result.current.projetoId).toBe('podesubir/site-institucional');
    expect(result.current.level).toBe('projetos');
  });

  it('JSON inválido ou com forma errada no localStorage cai para o padrão', () => {
    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, '{nao-e-json');
    const a = renderHook(() => useNavScope(projects, { initialClienteId: 'interno' }));
    expect(a.result.current.clienteId).toBe('interno');

    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify({ clienteId: 'interno', level: 'lateral' }));
    const b = renderHook(() => useNavScope(projects));
    expect(scopeOf(b.result)).toEqual(TODOS_SCOPE);
  });
});

describe('useNavScope — drill-down', () => {
  it('enterCliente seleciona o cliente inteiro e lista os projetos dele', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.enterCliente('podesubir'));
    expect(scopeOf(result)).toEqual({ clienteId: 'podesubir', projetoId: null, level: 'projetos', parentId: 'podesubir' });
  });

  it('selectCliente (cliente sem subprojetos) só seleciona, sem sair do nível Clientes', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.selectCliente('interno'));
    expect(scopeOf(result)).toEqual({ clienteId: 'interno', projetoId: null, level: 'clientes', parentId: null });
  });

  it('selectCliente(null) e reset() voltam para "Todos"', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.enterCliente('podesubir'));
    act(() => result.current.selectCliente(null));
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);

    act(() => result.current.enterCliente('podesubir'));
    act(() => result.current.reset());
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);
  });

  it('selectProjeto troca o projeto sem mudar o nível; null volta para "Todos os projetos"; o cliente é a Raiz', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.enterCliente('podesubir'));
    act(() => result.current.selectProjeto('podesubir/site-institucional'));
    expect(result.current.projetoId).toBe('podesubir/site-institucional');
    expect(result.current.level).toBe('projetos');

    act(() => result.current.selectProjeto('podesubir'));
    expect(result.current.projetoId).toBe('podesubir');

    act(() => result.current.selectProjeto(null));
    expect(result.current.projetoId).toBeNull();
  });

  it('selectProjeto ignora projeto de outro cliente e chamadas em "Todos"', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.selectProjeto('podesubir/site-institucional'));
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);

    act(() => result.current.enterCliente('podesubir'));
    act(() => result.current.selectProjeto('interno'));
    expect(result.current.projetoId).toBeNull();
  });

  it('enterProjeto desce um nível (3 níveis) e back() sobe para o pai, depois para Clientes, sem limpar a seleção', () => {
    const { result } = renderHook(() => useNavScope(projects));
    act(() => result.current.enterCliente('podesubir'));
    act(() => result.current.enterProjeto('podesubir/api-pagamentos'));
    expect(scopeOf(result)).toEqual({
      clienteId: 'podesubir',
      projetoId: 'podesubir/api-pagamentos',
      level: 'projetos',
      parentId: 'podesubir/api-pagamentos',
    });

    act(() => result.current.selectProjeto('podesubir/api-pagamentos/v2'));
    act(() => result.current.back());
    expect(result.current.parentId).toBe('podesubir');
    expect(result.current.level).toBe('projetos');
    expect(result.current.projetoId).toBe('podesubir/api-pagamentos/v2');

    act(() => result.current.back());
    expect(result.current.level).toBe('clientes');
    expect(result.current.parentId).toBeNull();
    expect(result.current.clienteId).toBe('podesubir');
    expect(result.current.projetoId).toBe('podesubir/api-pagamentos/v2');

    // No nível Clientes, back() não faz nada.
    act(() => result.current.back());
    expect(result.current.level).toBe('clientes');
  });
});

describe('useNavScope — persistência', () => {
  it('grava cada mudança em localStorage e restaura num novo mount', () => {
    const first = renderHook(() => useNavScope(projects));
    act(() => first.result.current.enterCliente('podesubir'));
    act(() => first.result.current.enterProjeto('podesubir/api-pagamentos'));
    expect(stored()).toEqual({
      clienteId: 'podesubir',
      projetoId: 'podesubir/api-pagamentos',
      level: 'projetos',
      parentId: 'podesubir/api-pagamentos',
    });
    first.unmount();

    const second = renderHook(() => useNavScope(projects));
    expect(scopeOf(second.result)).toEqual(stored());
  });
});

describe('useNavScope — validação contra projects', () => {
  it('projeto salvo que não existe mais cai para "Todos"', () => {
    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify({
      clienteId: 'podesubir', projetoId: 'podesubir/apagado', level: 'projetos', parentId: 'podesubir',
    }));
    const { result } = renderHook(() => useNavScope(projects));
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);
    expect(stored()).toEqual(TODOS_SCOPE);
  });

  it('cliente salvo que não existe mais cai para "Todos"', () => {
    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify({
      clienteId: 'sumiu', projetoId: null, level: 'clientes', parentId: null,
    }));
    const { result } = renderHook(() => useNavScope(projects));
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);
  });

  it('não valida enquanto a lista de projetos ainda não chegou, e valida quando ela chega', () => {
    const saved = { clienteId: 'podesubir', projetoId: 'podesubir/site-institucional', level: 'projetos', parentId: 'podesubir' };
    localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify(saved));
    const { result, rerender } = renderHook(({ list }) => useNavScope(list), { initialProps: { list: [] } });
    // Lista vazia (useProjects ainda carregando): a escolha salva sobrevive.
    expect(scopeOf(result)).toEqual(saved);

    rerender({ list: projects });
    expect(scopeOf(result)).toEqual(saved);

    // Um refetch que tira o projeto do disco derruba o escopo.
    rerender({ list: projects.filter((p) => p.id !== 'podesubir/site-institucional') });
    expect(scopeOf(result)).toEqual(TODOS_SCOPE);
  });
});

describe('sanitizeNavScope', () => {
  it('devolve a MESMA referência quando o escopo é válido', () => {
    const scope = { clienteId: 'podesubir', projetoId: 'podesubir', level: 'projetos', parentId: 'podesubir' };
    expect(sanitizeNavScope(scope, projects)).toBe(scope);
  });

  it('nível Projetos cujo pai não tem mais filhos cai para "Todos"', () => {
    const scope = { clienteId: 'interno', projetoId: null, level: 'projetos', parentId: 'interno' };
    expect(sanitizeNavScope(scope, projects)).toBe(TODOS_SCOPE);
  });

  it('rejeita combinações impossíveis (projeto de outro cliente, cliente com "/")', () => {
    expect(sanitizeNavScope({ clienteId: 'interno', projetoId: 'podesubir/site-institucional', level: 'clientes', parentId: null }, projects)).toBe(TODOS_SCOPE);
    expect(sanitizeNavScope({ clienteId: 'podesubir/site-institucional', projetoId: null, level: 'clientes', parentId: null }, projects)).toBe(TODOS_SCOPE);
  });
});
