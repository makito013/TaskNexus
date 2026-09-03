// frontend/src/layouts/v2/NewChatSheet.test.jsx
// QA (feature Clientes na sidebar v2, Bloco C): cobre o formulário de "+ Novo
// chat" isoladamente — "Criar chat" preso em disabled até um agente ser
// escolhido, select de Projeto ausente + texto informativo quando o cliente
// não tem sub_projetos, submit sem projeto escolhido cai em cliente.id (não
// undefined/string vazia), lista de agentes vazia/carregando, e o reset de
// seleção ao fechar (Cancelar/ESC/scrim — todos passam pelo mesmo
// `handleClose`, que é o `onClose` repassado ao BottomSheet).
//
// Modo "Todos": quando `cliente` vem null e `clientes` é
// passado no lugar, cobre o select extra de Cliente (primeiro campo), o
// select de Projeto só aparecendo depois de escolher um cliente, e o submit
// resolvendo a partir do cliente escolhido no picker.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NewChatSheet } from './NewChatSheet.jsx';

vi.mock('../../hooks/useAgentSettings.js', () => ({
  useAgentSettings: vi.fn(),
}));

import { useAgentSettings } from '../../hooks/useAgentSettings.js';

afterEach(() => cleanup());

const AGENTS = [
  { id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] },
  { id: 'gemini', nome: 'Gemini', papel: 'Assistente', ia: 'gemini', cmd: ['gemini'] },
];

const clienteSemSub = { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [], sub_projetos: [] };
const clienteComSub = {
  id: 'cliente_projeto_1',
  nome: 'Cliente 1',
  path: '/cliente_projeto_1',
  agentes: [],
  sub_projetos: ['cliente_projeto_1/subprojeto_1', 'cliente_projeto_1/gateways'],
};

beforeEach(() => {
  useAgentSettings.mockReturnValue({ agents: AGENTS, loading: false });
});

describe('NewChatSheet — "Criar chat" desabilitado até escolher agente', () => {
  it('começa desabilitado (nenhum agente pré-selecionado)', () => {
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('habilita depois de escolher um agente', () => {
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);
  });
});

describe('NewChatSheet — select de Projeto condicional', () => {
  it('cliente SEM sub_projetos: não mostra o select, mostra texto informativo com o nome do cliente', () => {
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/não tem subprojetos/)).not.toBeNull();
    expect(screen.getByText(/raiz de Pode Subir/)).not.toBeNull();
  });

  it('cliente COM sub_projetos: mostra o select com opção "Nenhum" + 1 opção por sub-projeto', () => {
    render(<NewChatSheet open cliente={clienteComSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Projeto (opcional)');
    expect(select).not.toBeNull();
    expect(screen.getByText('Nenhum (usa a raiz de Cliente 1)')).not.toBeNull();
  });

  it('[achado] as opções de sub-projeto mostram o ID CRU, não um nome resolvido — pode confundir o usuário', () => {
    // Documenta o comportamento atual apontado pelo Dev: NewChatSheet só
    // recebe o objeto `cliente` já resolvido (sub_projetos é list[str] de
    // ids, ver Project.sub_projetos em backend/app/models.py), sem a lista
    // completa de `projetos` para fazer lookup de nome bonito — diferente das
    // telas de Board/Tarefas, que sempre resolvem projeto_id -> nome via
    // `projetos`. Este teste FIXA o comportamento atual (ids crus, com o
    // prefixo do próprio cliente repetido) para que qualquer mudança futura
    // seja deliberada, não um efeito colateral silencioso.
    render(<NewChatSheet open cliente={clienteComSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Projeto (opcional)');
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toContain('cliente_projeto_1/subprojeto_1');
    expect(optionTexts).toContain('cliente_projeto_1/gateways');
  });
});

describe('NewChatSheet — submit', () => {
  it('sem projeto escolhido: onSubmit(cliente.id, agentId) — não undefined/vazio', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'gemini');
  });

  it('com projeto escolhido: onSubmit(projetoId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('clicar em "Criar chat" desabilitado (sem agente) não chama onSubmit', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit fecha o sheet (chama onClose)', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteSemSub} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('NewChatSheet — modo "Todos" (sem cliente fixo, select de Cliente)', () => {
  const clientes = [clienteSemSub, clienteComSub];

  it('cliente=null, clientes=[...]: mostra o select de Cliente como primeiro campo, título genérico, sem select de Projeto ainda', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat')).not.toBeNull();
    const clienteSelect = screen.getByLabelText('Cliente');
    expect(clienteSelect).not.toBeNull();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.queryByText(/não tem subprojetos/)).toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('escolher um cliente SEM sub_projetos: título atualiza, mostra o hint de raiz, sem select de Projeto', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    expect(screen.getByText('Novo chat em Pode Subir')).not.toBeNull();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/raiz de Pode Subir/)).not.toBeNull();
  });

  it('escolher um cliente COM sub_projetos: título atualiza e o select de Projeto aparece filtrado por esse cliente', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
    expect(screen.getByLabelText('Projeto (opcional)')).not.toBeNull();
    expect(screen.getByText('Nenhum (usa a raiz de Cliente 1)')).not.toBeNull();
  });

  it('submit sem sub-projeto: onSubmit(clienteEscolhido.id, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'gemini');
  });

  it('submit com sub-projeto escolhido: onSubmit(subProjetoId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('trocar o cliente escolhido reseta o sub-projeto selecionado anteriormente', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    // 'podesubir' não tem sub_projetos — se a seleção anterior não tivesse
    // sido resetada, o select nem existiria mais, mas o valor "vazado" não
    // pode aparecer se o usuário escolher outro cliente com sub_projetos.
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('');
  });

  it('clicar em "Criar chat" sem escolher cliente não chama onSubmit, mesmo com agente escolhido', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} onClose={vi.fn()} onSubmit={onSubmit} />);
    // Sem cliente escolhido "IA / Agente" nem chega a aparecer no fluxo real,
    // mas o guard de handleSubmit é testado diretamente via clique no botão
    // desabilitado (mesmo padrão dos outros testes de submit deste arquivo).
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clientes=[] (nenhum cliente disponível): mostra hint em vez de select vazio', () => {
    render(<NewChatSheet open cliente={null} clientes={[]} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.getByText('Nenhum cliente disponível.')).not.toBeNull();
  });

  it('Cancelar reseta o cliente escolhido no picker (não vaza pra próxima abertura)', () => {
    const onClose = vi.fn();
    const { rerender } = render(<NewChatSheet open cliente={null} clientes={clientes} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<NewChatSheet open cliente={null} clientes={clientes} onClose={onClose} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat')).not.toBeNull();
    expect(screen.getByLabelText('Cliente').value).toBe('');
  });

  it('cliente prop preenchido ignora `clientes` — comportamento fixo de sempre, sem select de Cliente', () => {
    render(<NewChatSheet open cliente={clienteComSub} clientes={clientes} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
  });
});

describe('NewChatSheet — registro global de agentes', () => {
  it('loading=true: mostra "Carregando agentes…" e não mostra o select', () => {
    useAgentSettings.mockReturnValue({ agents: [], loading: true });
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Carregando agentes…')).not.toBeNull();
    expect(screen.queryByLabelText('IA / Agente')).toBeNull();
  });

  it('registro vazio (loading=false, agents=[]): mostra dica, sem select, "Criar chat" preso em disabled', () => {
    useAgentSettings.mockReturnValue({ agents: [], loading: false });
    render(<NewChatSheet open cliente={clienteSemSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('IA / Agente')).toBeNull();
    expect(screen.getByText(/Nenhum agente cadastrado/)).not.toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });
});

describe('NewChatSheet — título e reset de seleção ao fechar', () => {
  it('mostra "Novo chat em {cliente.nome}"', () => {
    render(<NewChatSheet open cliente={clienteComSub} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
  });

  it('Cancelar chama onClose', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC reseta a seleção ANTES de fechar (handleClose passado como onClose ao BottomSheet), não só no próximo open (regressão)', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });

    // O componente-pai é quem decide desmontar/fechar via `onClose`; aqui
    // testamos isoladamente que o estado interno do formulário já volta ao
    // zero no mesmo instante (select "" de novo, botão desabilitado de
    // novo), sem esperar um novo `open` — bastaria remover o reset de
    // `handleClose` (ou trocar `onClose={handleClose}` por `onClose={onClose}`
    // cru no BottomSheet) para essa seleção "vazar" para a próxima abertura.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('');
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });
});
