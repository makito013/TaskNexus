// frontend/src/layouts/v2/NewChatSheet.test.jsx
// QA (feature Clientes na sidebar v2, Bloco C, + rodada "Novo chat em modal"):
// cobre o formulário de "+ Novo chat" isoladamente — "Criar chat" preso em
// disabled até um agente ser escolhido, select de Projeto usando
// `listSubProjectsForClient` (filtro por elegibilidade + ordem de árvore),
// fallback único quando não há sub-projeto elegível, submit sem projeto
// escolhido cai em cliente.id (não undefined/string vazia), lista de agentes
// vazia/carregando, e o reset de seleção ao fechar (Cancelar/ESC/scrim —
// todos passam pelo mesmo `handleClose`, que é o `onClose` repassado ao
// wrapper).
//
// Modo "Todos": quando `cliente` vem null e `clientes` é
// passado no lugar, cobre o select extra de Cliente (primeiro campo), o
// campo Projeto disabled até escolher um cliente, e o submit resolvendo a
// partir do cliente escolhido no picker.
//
// `presentation`: 'sheet' (default) roda dentro de BottomSheet — TODOS os
// describes abaixo, sem passar a prop, cobrem esse caso (regressão). Um bloco
// dedicado no fim cobre 'modal' (dentro de CenteredModal).

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

const clienteSemSub = { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [] };
const clienteComSub = { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [] };

// Flat `projects` array (as returned by /api/projetos) — includes the
// clients AND their eligible sub-projects as separate entries with
// `elegivel`. `clienteSemSub` deliberately has no eligible descendant here.
const PROJECTS = [
  { id: 'podesubir', nome: 'Pode Subir', elegivel: true },
  { id: 'cliente_projeto_1', nome: 'Cliente 1', elegivel: true },
  { id: 'cliente_projeto_1/subprojeto_1', nome: 'subprojeto_1', elegivel: true },
  { id: 'cliente_projeto_1/gateways', nome: 'gateways', elegivel: true },
];

beforeEach(() => {
  useAgentSettings.mockReturnValue({ agents: AGENTS, loading: false });
});

describe('NewChatSheet — "Criar chat" desabilitado até escolher agente', () => {
  it('começa desabilitado (nenhum agente pré-selecionado)', () => {
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('habilita depois de escolher um agente', () => {
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);
  });
});

describe('NewChatSheet — select de Projeto condicional', () => {
  it('cliente SEM sub-projeto elegível: não mostra o select, mostra o fallback único com o nome do cliente', () => {
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
  });

  it('cliente COM sub-projetos elegíveis: mostra o select com opção "Raiz de {nome}" + 1 opção por sub-projeto (label relativo)', () => {
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Projeto');
    expect(select).not.toBeNull();
    expect(screen.getByText('Raiz de Cliente 1')).not.toBeNull();
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toContain('subprojeto_1');
    expect(optionTexts).toContain('gateways');
  });

  it('projeto não-elegível (sem .claude/.gemini) some da lista, mesmo sendo descendente do cliente', () => {
    const projects = [
      ...PROJECTS,
      { id: 'cliente_projeto_1/nao-elegivel', nome: 'nao-elegivel', elegivel: false },
    ];
    render(<NewChatSheet open cliente={clienteComSub} projects={projects} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Projeto');
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).not.toContain('nao-elegivel');
  });
});

describe('NewChatSheet — submit', () => {
  it('sem projeto escolhido: onSubmit(cliente.id, agentId) — não undefined/vazio', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'gemini');
  });

  it('com projeto escolhido: onSubmit(projetoId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('cliente sem sub-projeto elegível: submit continua válido, usa activeCliente.id (fallback único)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('podesubir', 'claude');
  });

  it('clicar em "Criar chat" desabilitado (sem agente) não chama onSubmit', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit fecha o sheet (chama onClose)', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('NewChatSheet — modo "Todos" (sem cliente fixo, select de Cliente)', () => {
  const clientes = [clienteSemSub, clienteComSub];

  it('cliente=null, clientes=[...]: mostra o select de Cliente como primeiro campo, título genérico, campo Projeto disabled', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat')).not.toBeNull();
    const clienteSelect = screen.getByLabelText('Cliente');
    expect(clienteSelect).not.toBeNull();
    const projetoSelect = screen.getByLabelText('Projeto');
    expect(projetoSelect.disabled).toBe(true);
    expect(screen.getByText('Escolha um cliente para ver os projetos')).not.toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('escolher um cliente SEM sub-projeto elegível: título atualiza, mostra o fallback único, sem select de Projeto', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    expect(screen.getByText('Novo chat em Pode Subir')).not.toBeNull();
    expect(screen.queryByLabelText('Projeto')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
  });

  it('escolher um cliente COM sub-projetos elegíveis: título atualiza e o select de Projeto aparece filtrado por esse cliente', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
    const select = screen.getByLabelText('Projeto');
    expect(select.disabled).toBe(false);
    expect(screen.getByText('Raiz de Cliente 1')).not.toBeNull();
  });

  it('submit sem sub-projeto: onSubmit(clienteEscolhido.id, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'gemini');
  });

  it('submit com sub-projeto escolhido: onSubmit(subProjetoId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('trocar o cliente escolhido reseta o sub-projeto selecionado anteriormente', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    // 'podesubir' não tem sub-projeto elegível — se a seleção anterior não
    // tivesse sido resetada, o select nem existiria mais, mas o valor
    // "vazado" não pode aparecer se o usuário escolher outro cliente com
    // sub-projetos.
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByLabelText('Projeto').value).toBe('');
  });

  it('clicar em "Criar chat" sem escolher cliente não chama onSubmit, mesmo com agente escolhido', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    // Sem cliente escolhido "IA / Agente" nem chega a aparecer no fluxo real,
    // mas o guard de handleSubmit é testado diretamente via clique no botão
    // desabilitado (mesmo padrão dos outros testes de submit deste arquivo).
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clientes=[] (nenhum cliente disponível): mostra hint em vez de select vazio', () => {
    render(<NewChatSheet open cliente={null} clientes={[]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.getByText('Nenhum cliente disponível.')).not.toBeNull();
  });

  it('Cancelar reseta o cliente escolhido no picker (não vaza pra próxima abertura)', () => {
    const onClose = vi.fn();
    const { rerender } = render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat')).not.toBeNull();
    expect(screen.getByLabelText('Cliente').value).toBe('');
  });

  it('cliente prop preenchido ignora `clientes` — comportamento fixo de sempre, sem select de Cliente', () => {
    render(<NewChatSheet open cliente={clienteComSub} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
  });
});

describe('NewChatSheet — registro global de agentes', () => {
  it('loading=true: mostra "Carregando agentes…" e não mostra o select', () => {
    useAgentSettings.mockReturnValue({ agents: [], loading: true });
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Carregando agentes…')).not.toBeNull();
    expect(screen.queryByLabelText('IA / Agente')).toBeNull();
  });

  it('registro vazio (loading=false, agents=[]): mostra dica, sem select, "Criar chat" preso em disabled', () => {
    useAgentSettings.mockReturnValue({ agents: [], loading: false });
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('IA / Agente')).toBeNull();
    expect(screen.getByText(/Nenhum agente cadastrado/)).not.toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });
});

describe('NewChatSheet — título e reset de seleção ao fechar', () => {
  it('mostra "Novo chat em {cliente.nome}"', () => {
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
  });

  it('Cancelar chama onClose', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC reseta a seleção ANTES de fechar (handleClose passado como onClose ao wrapper), não só no próximo open (regressão)', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });

    // O componente-pai é quem decide desmontar/fechar via `onClose`; aqui
    // testamos isoladamente que o estado interno do formulário já volta ao
    // zero no mesmo instante (select "" de novo, botão desabilitado de
    // novo), sem esperar um novo `open` — bastaria remover o reset de
    // `handleClose` (ou trocar `onClose={handleClose}` por `onClose={onClose}`
    // cru no wrapper) para essa seleção "vazar" para a próxima abertura.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Projeto').value).toBe('');
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });
});

describe('NewChatSheet — presentation="sheet" (default, sem passar a prop): regressão completa', () => {
  it('renderiza dentro do BottomSheet (scrim/painel do BottomSheet, não do CenteredModal)', () => {
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('bottom-sheet-scrim')).not.toBeNull();
    expect(screen.queryByTestId('centered-modal-scrim')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('NewChatSheet — presentation="modal"', () => {
  it('renderiza dentro do CenteredModal (não do BottomSheet), com aria-label igual ao título visível', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('bottom-sheet-scrim')).toBeNull();
    expect(screen.getByTestId('centered-modal-scrim')).not.toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Novo chat em Cliente 1' });
    expect(dialog).not.toBeNull();
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
  });

  it('modo "Todos" pré-escolha: aria-label do modal é o título genérico "Novo chat"', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Novo chat' })).not.toBeNull();
  });

  it('tem um botão × com aria-label="Fechar" que chama onClose', () => {
    const onClose = vi.fn();
    render(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar e submit continuam funcionando (mesma lógica do modo sheet)', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'claude');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('campo Projeto disabled em modo "Todos" antes de escolher cliente', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const projetoSelect = screen.getByLabelText('Projeto');
    expect(projetoSelect.disabled).toBe(true);
    expect(screen.getByText('Escolha um cliente para ver os projetos')).not.toBeNull();
  });

  it('fallback único quando o cliente ativo não tem sub-projeto elegível', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
  });
});

// QA (achado da revisão): `initialFocusRef` alterna entre `clienteSelectRef`
// e `projetoSelectRef` (`projetoFieldPreChoice ? clienteSelectRef :
// projetoSelectRef`), mas nenhum teste acima verifica QUAL elemento recebe o
// foco — CenteredModal.test.jsx só cobre o fallback da primitiva isolada
// (Fixture sintética), não esta escolha real de ref. Sem asserção de
// `document.activeElement`, um bug que trocasse as duas branches (ou
// quebrasse a ref population) passaria silenciosamente: CenteredModal cai no
// fallback (foco no painel) sempre que a ref escolhida está null, o que é
// indistinguível de "funcionou" a olho nu no relatório de testes.
describe('NewChatSheet — presentation="modal": QUAL elemento recebe o foco inicial', () => {
  it('modo "Todos" pré-escolha de cliente: foco inicial no select de Cliente (projetoFieldPreChoice=true)', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Cliente'));
  });

  it('cliente fixo COM sub-projetos elegíveis: foco inicial no select de Projeto', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Projeto'));
  });

  it('cliente fixo SEM sub-projeto elegível: projetoSelectRef fica null (select nem renderiza) — CenteredModal cai no fallback do painel, sem crash', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('centered-modal-panel'));
  });
});
