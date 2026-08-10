// frontend/src/layouts/v2/NewChatSheet.test.jsx
// QA (feature Clientes na sidebar v2, Bloco C): cobre o formulário de "+ Novo
// chat" isoladamente — "Criar chat" preso em disabled até um agente ser
// escolhido, select de Projeto ausente + texto informativo quando o cliente
// não tem sub_projetos, submit sem projeto escolhido cai em cliente.id (não
// undefined/string vazia), lista de agentes vazia/carregando, e o reset de
// seleção ao fechar (Cancelar/ESC/scrim — todos passam pelo mesmo
// `handleClose`, que é o `onClose` repassado ao BottomSheet).

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
    // completa de `projetos` para fazer lookup de nome bonito — diferente de
    // KanbanBoard/BoardView, que sempre resolvem projeto_id -> nome via
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
