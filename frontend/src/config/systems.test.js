// frontend/src/config/systems.test.js
// Confirma a ordem exata das 3 entradas de SYSTEMS e os valores de `rota`
// (App Launcher / AppLauncherHeader dependem dessa ordem — Tarefas > Board >
// Escritório, granularidade crescente, decisão de 05-ARQUITETO.md/05-DESIGNER.md).

import { describe, it, expect } from 'vitest';
import { SYSTEMS, getSystemByRoute } from './systems.js';

describe('SYSTEMS', () => {
  it('tem exatamente 3 entradas, na ordem Tarefas, Board, Escritório', () => {
    expect(SYSTEMS.map((s) => s.id)).toEqual(['tarefas', 'board', 'escritorio']);
  });

  it('define as rotas esperadas para cada sistema', () => {
    expect(SYSTEMS.map((s) => s.rota)).toEqual(['/tarefas', '/board', '/']);
  });

  it('cada entrada tem id, nome, rota e icone definidos', () => {
    for (const system of SYSTEMS) {
      expect(system.id).toEqual(expect.any(String));
      expect(system.nome).toEqual(expect.any(String));
      expect(system.rota).toEqual(expect.any(String));
      expect(system.icone).toEqual(expect.any(String));
    }
  });
});

describe('getSystemByRoute', () => {
  it('resolve cada rota exata para a entrada correta', () => {
    expect(getSystemByRoute('/tarefas').id).toBe('tarefas');
    expect(getSystemByRoute('/board').id).toBe('board');
    expect(getSystemByRoute('/').id).toBe('escritorio');
  });

  it('retorna undefined para uma rota que não bate com nenhum sistema', () => {
    expect(getSystemByRoute('/inexistente')).toBeUndefined();
  });
});
