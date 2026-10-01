// frontend/src/utils/projectTree.test.js
// Fase N, passo 1: helpers puros da árvore cliente → projeto → subprojeto.
// O caso de 3 níveis e o par "cliente" × "cliente2/x" são os dois que já
// quebraram filtro neste repo (ver useClienteProjetoFilter.test.js), então
// aparecem em quase todo describe abaixo.

import { describe, it, expect } from 'vitest';
import {
  childrenOf,
  hasChildren,
  isInScope,
  isRaizScope,
  labelFor,
  parentOf,
  scopeLabel,
} from './projectTree.js';

const projects = [
  { id: 'podesubir', nome: 'podesubir', elegivel: true },
  { id: 'podesubir/site-institucional', nome: 'site-institucional', elegivel: true },
  { id: 'podesubir/api-pagamentos', nome: 'api-pagamentos', elegivel: false },
  { id: 'podesubir/api-pagamentos/v1', nome: 'v1', elegivel: true },
  { id: 'podesubir/api-pagamentos/v2', nome: 'v2', elegivel: true },
  { id: 'podesubir/app-mobile', nome: 'app-mobile', elegivel: true },
  { id: 'cliente', nome: 'Cliente', elegivel: true },
  { id: 'cliente2', nome: 'Cliente 2', elegivel: false },
  { id: 'cliente2/x', nome: 'X', elegivel: true },
  { id: 'interno', nome: 'interno', elegivel: true },
];

describe('parentOf', () => {
  it('devolve o id sem o último segmento', () => {
    expect(parentOf('podesubir/site-institucional')).toBe('podesubir');
    expect(parentOf('podesubir/api-pagamentos/v2')).toBe('podesubir/api-pagamentos');
  });

  it('devolve null para um cliente (nível-topo) e para valores vazios', () => {
    expect(parentOf('podesubir')).toBeNull();
    expect(parentOf('')).toBeNull();
    expect(parentOf(null)).toBeNull();
    expect(parentOf(undefined)).toBeNull();
  });
});

describe('childrenOf', () => {
  it('lista só os filhos DIRETOS de um cliente, em ordem de árvore', () => {
    expect(childrenOf('podesubir', projects).map((p) => p.id)).toEqual([
      'podesubir/api-pagamentos',
      'podesubir/app-mobile',
      'podesubir/site-institucional',
    ]);
  });

  it('lista os filhos diretos de um projeto (3º nível)', () => {
    expect(childrenOf('podesubir/api-pagamentos', projects).map((p) => p.id)).toEqual([
      'podesubir/api-pagamentos/v1',
      'podesubir/api-pagamentos/v2',
    ]);
  });

  it('não mistura ids parecidos: "cliente" não é pai de "cliente2/x"', () => {
    expect(childrenOf('cliente', projects)).toEqual([]);
    expect(childrenOf('cliente2', projects).map((p) => p.id)).toEqual(['cliente2/x']);
  });

  it('devolve [] para folha, id vazio ou lista ausente', () => {
    expect(childrenOf('podesubir/app-mobile', projects)).toEqual([]);
    expect(childrenOf(null, projects)).toEqual([]);
    expect(childrenOf('podesubir', undefined)).toEqual([]);
  });

  it('não altera a lista recebida (ordena uma cópia)', () => {
    const copy = projects.map((p) => p.id);
    childrenOf('podesubir', projects);
    expect(projects.map((p) => p.id)).toEqual(copy);
  });
});

describe('hasChildren', () => {
  it('true para cliente e projeto com descendentes', () => {
    expect(hasChildren('podesubir', projects)).toBe(true);
    expect(hasChildren('podesubir/api-pagamentos', projects)).toBe(true);
  });

  it('false para folhas e clientes sem subprojetos', () => {
    expect(hasChildren('podesubir/app-mobile', projects)).toBe(false);
    expect(hasChildren('interno', projects)).toBe(false);
  });

  it('não confunde prefixo de caracteres com prefixo de pasta', () => {
    expect(hasChildren('cliente', projects)).toBe(false);
  });

  it('false para id vazio ou lista ausente', () => {
    expect(hasChildren(null, projects)).toBe(false);
    expect(hasChildren('podesubir', undefined)).toBe(false);
  });
});

describe('labelFor', () => {
  it('usa o nome do projeto quando ele existe na lista', () => {
    expect(labelFor('cliente2/x', projects)).toBe('X');
  });

  it('cai para o último segmento do id quando o projeto não está na lista', () => {
    expect(labelFor('fantasma/pasta-sumida', projects)).toBe('pasta-sumida');
    expect(labelFor('fantasma', [])).toBe('fantasma');
  });

  it('string vazia para id vazio', () => {
    expect(labelFor(null, projects)).toBe('');
  });
});

describe('isRaizScope', () => {
  it('só é Raiz quando o projeto é o próprio cliente', () => {
    expect(isRaizScope('podesubir', 'podesubir')).toBe(true);
    expect(isRaizScope('podesubir', null)).toBe(false);
    expect(isRaizScope('podesubir', 'podesubir/app-mobile')).toBe(false);
    expect(isRaizScope(null, null)).toBe(false);
  });
});

describe('isInScope', () => {
  it('"Todos" (sem cliente) deixa tudo passar', () => {
    expect(isInScope('podesubir/app-mobile', null, null)).toBe(true);
    expect(isInScope('interno', null, null)).toBe(true);
  });

  it('cliente sem projeto: qualquer coisa do cliente, em qualquer profundidade', () => {
    expect(isInScope('podesubir', 'podesubir', null)).toBe(true);
    expect(isInScope('podesubir/api-pagamentos/v2', 'podesubir', null)).toBe(true);
    expect(isInScope('interno', 'podesubir', null)).toBe(false);
  });

  it('cliente sem projeto não pega cliente com id parecido', () => {
    expect(isInScope('cliente2/x', 'cliente', null)).toBe(false);
    expect(isInScope('cliente2', 'cliente', null)).toBe(false);
  });

  it('Raiz: só o próprio cliente, nenhum subprojeto', () => {
    expect(isInScope('podesubir', 'podesubir', 'podesubir')).toBe(true);
    expect(isInScope('podesubir/app-mobile', 'podesubir', 'podesubir')).toBe(false);
  });

  it('projeto: ele e a subárvore inteira (3 níveis)', () => {
    const scope = ['podesubir', 'podesubir/api-pagamentos'];
    expect(isInScope('podesubir/api-pagamentos', ...scope)).toBe(true);
    expect(isInScope('podesubir/api-pagamentos/v2', ...scope)).toBe(true);
    expect(isInScope('podesubir', ...scope)).toBe(false);
    expect(isInScope('podesubir/app-mobile', ...scope)).toBe(false);
  });

  it('projeto não pega irmão com nome que começa igual', () => {
    expect(isInScope('podesubir/api-pagamentos2', 'podesubir', 'podesubir/api-pagamentos')).toBe(false);
  });

  it('com escopo ativo, um projeto vazio/ausente nunca passa', () => {
    expect(isInScope('', 'podesubir', null)).toBe(false);
    expect(isInScope(null, 'podesubir', null)).toBe(false);
  });
});

describe('scopeLabel', () => {
  it('"Todos" não tem rótulo; cliente sozinho é o nome dele', () => {
    expect(scopeLabel(null, null, projects)).toBe('');
    expect(scopeLabel('cliente2', null, projects)).toBe('Cliente 2');
  });

  it('projeto: "cliente / projeto", com o caminho relativo em 3+ níveis', () => {
    expect(scopeLabel('podesubir', 'podesubir/app-mobile', projects)).toBe('podesubir / app-mobile');
    expect(scopeLabel('podesubir', 'podesubir/api-pagamentos/v2', projects)).toBe('podesubir / api-pagamentos / v2');
  });

  it('Raiz: "cliente / Raiz"', () => {
    expect(scopeLabel('podesubir', 'podesubir', projects)).toBe('podesubir / Raiz');
  });
});
