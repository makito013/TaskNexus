// frontend/src/config/systems.test.js
// Confirma a ordem exata das entradas de SYSTEMS e os valores de `rota`
// (App Launcher / AppLauncherHeader dependem dessa ordem — Tarefas >
// Escritório, granularidade crescente, decisão de 05-ARQUITETO.md/05-DESIGNER.md).
// A entrada `board` saiu junto com a tela v1 que servia a rota `/board`.

import { describe, it, expect } from 'vitest';
import { SYSTEMS, getSystemByRoute } from './systems.js';

describe('SYSTEMS', () => {
  it('tem exatamente 2 entradas, na ordem Tarefas, Escritório', () => {
    expect(SYSTEMS.map((s) => s.id)).toEqual(['tarefas', 'escritorio']);
  });

  it('define as rotas esperadas para cada sistema', () => {
    expect(SYSTEMS.map((s) => s.rota)).toEqual(['/tarefas', '/']);
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
    expect(getSystemByRoute('/').id).toBe('escritorio');
  });

  it('retorna undefined para uma rota que não bate com nenhum sistema', () => {
    expect(getSystemByRoute('/inexistente')).toBeUndefined();
  });

  it('retorna undefined para a rota /board retirada (bookmark antigo)', () => {
    expect(getSystemByRoute('/board')).toBeUndefined();
  });
});
