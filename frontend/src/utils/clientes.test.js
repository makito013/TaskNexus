// frontend/src/utils/clientes.test.js
import { describe, it, expect } from 'vitest';
import { clienteIdFromProjetoId } from './clientes.js';

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
