// frontend/src/layouts/v2/ChatSidebarV2.test.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 14): paridade de dados com
// Sidebar.jsx (v1) — este teste reaproveita a MESMA fixture de projeto
// (`projectWithClaudeWork`) e a mesma forma de persistedSessions/
// activeSessions usadas em components/Sidebar.test.jsx, para garantir que
// ChatSidebarV2 (agrupada por projeto) e ChatV2 (terminal real montado)
// leem os dados exatamente como a superfície v1 já lê — sem estado novo.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ChatSidebarV2 } from './ChatSidebarV2.jsx';
import { ChatV2 } from './ChatV2.jsx';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed.js';

// TerminalPanel monta xterm.js/WebSocket reais — fora de escopo para este
// teste de integração de dados (não é o que está sendo verificado aqui, e já
// tem cobertura própria em components/TerminalPanel.test.jsx). Mockado como
// um marcador simples, mesmo padrão usado em App.test.jsx para Sidebar.jsx.
vi.mock('../../components/TerminalPanel.jsx', () => ({
  TerminalPanel: ({ sessionKey, agentId, visible }) => (
    <div data-testid={`terminal-${sessionKey}`} data-visible={String(visible)}>
      terminal:{agentId}
    </div>
  ),
}));

// Bloco D (feature Clientes na sidebar v2): lookup de agente/nome de chat
// passou a vir do registro GLOBAL (useAgentSettings), não mais de
// `project.agentes`. `vi.fn()` (não um retorno fixo) para poder sobrescrever
// a fixture por teste (ex.: registro global vazio, agente deletado) sem
// precisar de um módulo mockado por describe.
vi.mock('../../hooks/useAgentSettings.js', () => ({
  useAgentSettings: vi.fn(),
}));

import { useAgentSettings } from '../../hooks/useAgentSettings.js';

const GLOBAL_AGENTS_FIXTURE = {
  agents: [
    { id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] },
    { id: 'claude-work', nome: 'Claude (Work)', papel: 'Assistente', ia: 'claude', cmd: ['claude-work'] },
  ],
  loading: false,
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
};

beforeEach(() => {
  useAgentSettings.mockReturnValue(GLOBAL_AGENTS_FIXTURE);
});

afterEach(() => cleanup());

const noop = () => {};

// Mesma fixture de components/Sidebar.test.jsx — dois agentes Claude no
// mesmo projeto, para garantir paridade de comportamento (rótulos, badges).
const projectWithClaudeWork = {
  id: 'meu-projeto',
  nome: 'Meu Projeto',
  path: '/tmp/meu-projeto',
  agentes: [
    { id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'], default: true },
    { id: 'claude-work', nome: 'Claude (Work)', papel: 'Assistente', ia: 'claude', cmd: ['claude-work'], default: false },
  ],
  sub_projetos: [],
};

const secondProject = {
  id: 'outro-projeto',
  nome: 'Outro Projeto',
  path: '/tmp/outro-projeto',
  agentes: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'], default: true }],
  sub_projetos: [],
};

const projects = [projectWithClaudeWork, secondProject];

// Mesmo shape de persistedSessions usado pelos testes/produção de Sidebar.jsx
// (keyed by "{projectId}::{agentId}").
const persistedSessions = {
  'meu-projeto::claude': { display_name: null, needs_attention: false },
  'meu-projeto::claude-work': { display_name: 'Bugfix urgente', needs_attention: false },
  'outro-projeto::claude': { display_name: null, needs_attention: false },
};

const activeSessions = {
  'meu-projeto::claude': { status: 'running' },
  'meu-projeto::claude-work': { status: 'idle' },
};

// Bloco D: `selectedProjectId` virou `selectedClienteId` — 'meu-projeto' e
// 'outro-projeto' não têm "/" no id, então continuam sendo clientes de si
// mesmos (clienteIdFromProjetoId é identidade pra eles), preservando o
// mesmo cenário de dados dos testes abaixo.
const chatSidebarBaseProps = {
  projects,
  activeSessionKey: null,
  activeSessions,
  persistedSessions,
  selectedClienteId: 'meu-projeto',
  onSelectChat: noop,
  onRenameChat: noop,
  onCloseChat: noop,
  onStartNewChat: noop,
};

describe('ChatSidebarV2 — same data/handlers as Sidebar.jsx v1, grouped by cliente', () => {
  it('groups open chats under their cliente name (modo "Todos")', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} />);
    // The cliente name also appears a second time per row (rowMeta chip), so
    // the group HEADER specifically is targeted via its own testid rather
    // than an ambiguous screen.getByText('Meu Projeto').
    expect(screen.getByTestId('chat-group-label-meu-projeto').textContent).toBe('Meu Projeto');
    expect(screen.getByTestId('chat-group-label-outro-projeto').textContent).toBe('Outro Projeto');
  });

  it('labels chats using the same tabLabels() convention as Sidebar.jsx (positional default + custom display_name)', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} />);
    // Scoped to "Meu Projeto"'s group: 'outro-projeto' also has a lone
    // "claude" chat, which (correctly, per tabLabels — numbering is scoped
    // per project) ALSO renders plain "Claude", so an unscoped query would be
    // ambiguous. That duplication across groups is itself part of the parity
    // being asserted here, not an accident.
    const group = screen.getByTestId('chat-group-meu-projeto');
    // 'meu-projeto::claude' has no display_name and is the sole "claude" chat
    // in that project -> plain agent name "Claude".
    expect(within(group).getByText('Claude')).toBeTruthy();
    // 'meu-projeto::claude-work' was renamed -> custom label wins over the
    // positional default ("Claude (Work)").
    expect(within(group).getByText('Bugfix urgente')).toBeTruthy();
  });

  it('shows the running-status ring only on the chat whose activeSessions status is "running"', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} />);
    const runningAvatar = screen.getByText('C', { selector: '.v2-chat-avatar--running' });
    expect(runningAvatar).toBeTruthy();
  });

  it('clicking a chat row calls onSelectChat with the session/project/agent ids', () => {
    const onSelectChat = vi.fn();
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} onSelectChat={onSelectChat} />);
    const group = screen.getByTestId('chat-group-meu-projeto');
    fireEvent.click(within(group).getByText('Claude'));
    expect(onSelectChat).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'meu-projeto::claude', projectId: 'meu-projeto', agentId: 'claude' })
    );
  });

  it('"+ Novo chat" opens the NewChatSheet for the selected cliente (Bloco C/D — não spawna mais direto)', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId="outro-projeto" />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(screen.getByText('Novo chat em Outro Projeto')).toBeTruthy();
  });

  it('"+ Novo chat" fica habilitado em modo "Todos" (nenhum cliente selecionado) — abre o sheet com select de Cliente', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} />);
    const btn = screen.getByText('+ Novo chat').closest('button');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(screen.getByText('Novo chat')).toBeTruthy();
    expect(screen.getByLabelText('Cliente')).toBeTruthy();
  });

  it('renders an empty state when there are no persisted sessions anywhere (modo "Todos")', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} persistedSessions={{}} />);
    expect(screen.getByText('Nenhum chat aberto ainda.')).toBeTruthy();
  });

  it('renders a cliente-scoped empty state when the selected cliente has no open chats', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId="outro-projeto" persistedSessions={{}} />);
    expect(screen.getByText(/Nenhum chat aberto para Outro Projeto/)).toBeTruthy();
  });

  it('"+ Novo chat" em "Todos" tem o tooltip de "escolha o cliente" (não mais o de desabilitado)', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} />);
    const btn = screen.getByText('+ Novo chat').closest('button');
    expect(btn.title).toMatch(/escolha o cliente/);
  });

  it('falls back to the raw agentId as the chat label when the agent was deleted from the global registry (edge case)', () => {
    // 'agente-removido' não existe em GLOBAL_AGENTS_FIXTURE.agents — o
    // lookup em ChatSidebarV2 (globalAgents.find) retorna undefined, e
    // tabLabels() já cai no fallback `s.agentId` cru (mesmo contrato de
    // antes). O ponto sob teste aqui é que isso NÃO quebra a renderização.
    render(
      <ChatSidebarV2
        {...chatSidebarBaseProps}
        selectedClienteId="outro-projeto"
        persistedSessions={{ 'outro-projeto::agente-removido': { display_name: null } }}
      />
    );
    expect(screen.getByText('agente-removido')).toBeTruthy();
  });
});

describe('ChatSidebarV2 — "+ Novo chat" abre o NewChatSheet e integra com onStartNewChat', () => {
  const clienteComSub = {
    id: 'cliente_projeto_1',
    nome: 'Cliente 1',
    path: '/tmp/cliente_projeto_1',
    agentes: [],
  };
  // Bloco 5 (Tarefa 12): o select de Projeto agora lê de `projects` (flat,
  // via listSubProjectsForClient), não mais de `cliente.sub_projetos` — a
  // fixture precisa de uma 2ª entrada representando o sub-projeto em si,
  // com `elegivel: true`.
  const subProjetoDoCliente = {
    id: 'cliente_projeto_1/subprojeto_1',
    nome: 'subprojeto_1',
    path: '/tmp/cliente_projeto_1/subprojeto_1',
    agentes: [],
    elegivel: true,
  };
  const propsComCliente = {
    ...chatSidebarBaseProps,
    projects: [clienteComSub, subProjetoDoCliente],
    selectedClienteId: 'cliente_projeto_1',
    persistedSessions: {},
    activeSessions: {},
  };

  it('submeter sem escolher projeto chama onStartNewChat(cliente.id, agentId) — não undefined (caso de borda #3)', () => {
    const onStartNewChat = vi.fn();
    render(<ChatSidebarV2 {...propsComCliente} onStartNewChat={onStartNewChat} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1', 'claude');
  });

  it('submeter com um sub-projeto escolhido chama onStartNewChat(subProjetoId, agentId)', () => {
    const onStartNewChat = vi.fn();
    render(<ChatSidebarV2 {...propsComCliente} onStartNewChat={onStartNewChat} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude-work' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude-work');
  });

  it('modo "Todos": escolher um cliente no sheet e submeter chama onStartNewChat(clienteEscolhido.id, agentId)', () => {
    const onStartNewChat = vi.fn();
    render(
      <ChatSidebarV2
        {...propsComCliente}
        selectedClienteId={null}
        onStartNewChat={onStartNewChat}
      />
    );
    fireEvent.click(screen.getByText('+ Novo chat'));
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1', 'claude');
  });

  it('registro global de agentes vazio: select some, "Criar chat" preso em disabled (caso de borda #5)', () => {
    useAgentSettings.mockReturnValue({ agents: [], loading: false, createAgent: vi.fn(), updateAgent: vi.fn(), deleteAgent: vi.fn() });
    render(<ChatSidebarV2 {...propsComCliente} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(screen.queryByLabelText('IA / Agente')).toBeNull();
    expect(screen.getByText(/Nenhum agente cadastrado/)).toBeTruthy();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('[fix achado crítico] cliente selecionado não encontrado em `projects` (ex.: removido depois de selecionado): botão fica desabilitado e não quebra com TypeError', async () => {
    // selectedClienteId aponta para um id que NÃO existe em `projects` —
    // cenário real: useProjects() só busca uma vez no mount, sem refetch, e o
    // cliente selecionado pode ficar "órfão" se a lista mudar depois.
    // Antes do fix, o botão "+ Novo chat" ficava HABILITADO (só olhava
    // selectedClienteId != null, não se o cliente existe de fato), abrindo o
    // NewChatSheet com `cliente=null` — handleSubmit fazia `cliente.id` e
    // lançava TypeError, sem error boundary, derrubando a UI inteira.
    //
    // Fix: `disabled`/`title` do botão agora também checam se
    // `selectedClienteId` resolve para um Project real em `projects`
    // (`selectedCliente`), então o botão fica desabilitado e o sheet nunca
    // chega a abrir para um cliente órfão.
    const onStartNewChat = vi.fn();
    const onWindowError = vi.fn((e) => e.preventDefault());
    window.addEventListener('error', onWindowError);
    try {
      render(
        <ChatSidebarV2
          {...chatSidebarBaseProps}
          projects={[]}
          selectedClienteId="cliente-removido"
          onStartNewChat={onStartNewChat}
        />
      );
      const btn = screen.getByText('+ Novo chat').closest('button');
      expect(btn.disabled).toBe(true);
      expect(btn.title).toMatch(/não encontrado em projects/i);

      fireEvent.click(btn);

      // Botão desabilitado: o sheet nunca abre, então nem os campos existem.
      expect(screen.queryByLabelText('IA / Agente')).toBeNull();
      expect(screen.queryByText('Criar chat')).toBeNull();

      // Dá uma chance de qualquer erro deferido (setTimeout 0 do React)
      // acontecer, e confirma que nada quebrou nem chamou onStartNewChat.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onWindowError).not.toHaveBeenCalled();
      expect(onStartNewChat).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('error', onWindowError);
    }
  });
});

// Rodada "Novo chat em modal" — CenteredModal wiring (Bloco 5, Tarefa 11/12):
// ChatSidebarV2 passa presentation="modal" ao NewChatSheet, guarda uma ref do
// botão "+ Novo chat" e devolve o foco a ele quando o modal fecha.
describe('ChatSidebarV2 — CenteredModal wiring (foco/fechamento)', () => {
  const cliente = {
    id: 'outro-projeto',
    nome: 'Outro Projeto',
    path: '/tmp/outro-projeto',
    agentes: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'], default: true }],
  };
  const propsComCliente = {
    ...chatSidebarBaseProps,
    projects: [cliente],
    selectedClienteId: 'outro-projeto',
    persistedSessions: {},
    activeSessions: {},
  };

  it('o botão × do modal tem aria-label="Fechar"', () => {
    render(<ChatSidebarV2 {...propsComCliente} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(screen.getByLabelText('Fechar')).toBeTruthy();
  });

  it('fechar o modal (botão ×) devolve o foco ao gatilho "+ Novo chat"', () => {
    render(<ChatSidebarV2 {...propsComCliente} />);
    const trigger = screen.getByText('+ Novo chat').closest('button');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Fechar'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('fechar o modal (Cancelar) também devolve o foco ao gatilho', () => {
    render(<ChatSidebarV2 {...propsComCliente} />);
    const trigger = screen.getByText('+ Novo chat').closest('button');
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText('Cancelar'));

    expect(document.activeElement).toBe(trigger);
  });

  it('onNewChatOpenChange é chamado com true ao abrir e false ao fechar', () => {
    const onNewChatOpenChange = vi.fn();
    render(<ChatSidebarV2 {...propsComCliente} onNewChatOpenChange={onNewChatOpenChange} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(false);
  });

  // Achado da revisão (mesma classe de bug já documentada em
  // MobileChatSheet.jsx): sem este guard, `onNewChatOpenChange(false)` nunca
  // seria chamado nestes 2 caminhos, e `newChatOpen` ficaria travado em
  // `true` no AppV2 — o wrapper principal ficaria `inert` para sempre, sem
  // nenhum modal na tela.
  it('cliente selecionado vira órfão com o modal aberto: onNewChatOpenChange(false) é chamado (evita inert travado)', () => {
    const onNewChatOpenChange = vi.fn();
    const { rerender } = render(<ChatSidebarV2 {...propsComCliente} onNewChatOpenChange={onNewChatOpenChange} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(true);

    // O cliente selecionado some de `projects` (ex.: removido do disco,
    // refetch) enquanto o NewChatSheet está aberto.
    rerender(<ChatSidebarV2 {...propsComCliente} projects={[]} onNewChatOpenChange={onNewChatOpenChange} />);

    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ChatSidebarV2 desmonta (breakpoint mobile) com o modal aberto: onNewChatOpenChange(false) é chamado no cleanup', () => {
    const onNewChatOpenChange = vi.fn();
    const { unmount } = render(<ChatSidebarV2 {...propsComCliente} onNewChatOpenChange={onNewChatOpenChange} />);
    fireEvent.click(screen.getByText('+ Novo chat'));
    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(true);

    unmount();

    expect(onNewChatOpenChange).toHaveBeenLastCalledWith(false);
  });
});

// Etapa 7 (plano de fix, RF02): coluna vira recolhível ("rail" de 68px),
// escondendo o header ("+ Novo chat") e o TEXTO da lista (nome/meta/botão de
// fechar/rótulo de grupo) quando collapsed=true.
//
// QA (retrabalho pontual — avatares no modo recolhido): esta suíte
// originalmente descrevia o "rail" como escondendo COMPLETAMENTE a lista,
// o que não é mais preciso — cada chat continua visível como avatar
// clicável (só nome/meta/botão de fechar/rótulo de grupo somem). A
// cobertura detalhada desse contrato (clique no avatar, anel "rodando",
// destaque do item ativo) vive em ChatList.test.jsx; aqui só corrigimos a
// descrição/asserção desatualizada, sem enfraquecer o que já era checado
// (os testids de TEXTO do grupo continuam ausentes, como sempre estiveram).
describe('ChatSidebarV2 — collapsed (RF02)', () => {
  it('collapsed=true: esconde "+ Novo chat" e o texto da lista (nome/meta/rótulo de grupo), mas mantém os avatares dos chats', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} collapsed onToggleCollapsed={noop} />);
    expect(screen.queryByText('+ Novo chat')).toBeNull();
    expect(screen.queryByTestId('chat-group-label-meu-projeto')).toBeNull();
    expect(screen.queryByTestId('chat-group-label-outro-projeto')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mostrar conversas' })).toBeTruthy();
    // Avatares continuam renderizados no lugar do texto (3 chats na fixture).
    expect(document.querySelectorAll('.v2-chat-avatar')).toHaveLength(3);
  });

  it('collapsed=false: mostra "+ Novo chat" e a lista normalmente', () => {
    render(<ChatSidebarV2 {...chatSidebarBaseProps} selectedClienteId={null} collapsed={false} onToggleCollapsed={noop} />);
    expect(screen.getByText('+ Novo chat')).toBeTruthy();
    expect(screen.getByTestId('chat-group-label-meu-projeto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Esconder conversas' })).toBeTruthy();
  });

  it('clicar no botão de toggle (estado recolhido) chama onToggleCollapsed', () => {
    const onToggleCollapsed = vi.fn();
    render(<ChatSidebarV2 {...chatSidebarBaseProps} collapsed onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar conversas' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});

// QA (etapa 8): requisito crítico RF03 — o toggle de ChatSidebarV2 PRECISA
// passar pelo hook COMPARTILHADO useSidebarCollapsed (que dispara o
// CustomEvent global `escritorio:sidebar-toggled`), não por um useState
// local. Um useState local passaria em todos os testes de "collapsed" acima
// (eles só olham a prop), mas reintroduziria o bug do espaço morto no
// terminal, porque só o hook dispara o evento que TerminalPanel escuta pra
// reagendar fitAddon.fit(). Este teste monta ChatSidebarV2 atrás de um
// wrapper que usa o hook DE VERDADE (não mockado) — se AppV2 (ou qualquer
// consumidor futuro) trocar o hook por estado local, este é o teste que
// quebra.
describe('ChatSidebarV2 — integração com useSidebarCollapsed real (guarda de regressão RF03)', () => {
  const INTEGRATION_KEY = 'escritorio::test_chat_sidebar_collapsed_integration';
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    localStorage.removeItem(INTEGRATION_KEY);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(INTEGRATION_KEY);
  });

  function ChatSidebarV2WithRealHook(props) {
    const [collapsed, toggle] = useSidebarCollapsed(INTEGRATION_KEY);
    return <ChatSidebarV2 {...props} collapsed={collapsed} onToggleCollapsed={toggle} />;
  }

  it('clicar no toggle (hook real, não mockado) dispara escritorio:sidebar-toggled', () => {
    render(<ChatSidebarV2WithRealHook {...chatSidebarBaseProps} selectedClienteId={null} />);

    const handler = vi.fn();
    window.addEventListener('escritorio:sidebar-toggled', handler);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Esconder conversas' }));
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('escritorio:sidebar-toggled', handler);
    }
  });
});

describe('ChatV2 — mounts the real TerminalPanel with AppV1-equivalent props', () => {
  const sessions = [
    { sessionKey: 'meu-projeto::claude', projectId: 'meu-projeto', agentId: 'claude' },
    { sessionKey: 'meu-projeto::claude-work', projectId: 'meu-projeto', agentId: 'claude-work' },
  ];

  it('shows an empty state when no chat is active', () => {
    render(<ChatV2 sessions={[]} activeSessionKey={null} projects={projects} />);
    expect(screen.getByText(/Selecione um chat/)).toBeTruthy();
  });

  it('mounts a TerminalPanel per open session and marks only the active one as visible', () => {
    render(<ChatV2 sessions={sessions} activeSessionKey="meu-projeto::claude-work" projects={projects} />);

    const inactive = screen.getByTestId('terminal-meu-projeto::claude');
    const active = screen.getByTestId('terminal-meu-projeto::claude-work');
    expect(inactive.dataset.visible).toBe('false');
    expect(active.dataset.visible).toBe('true');
  });

  it('shows the active session\'s agent name and project name in the header', () => {
    render(<ChatV2 sessions={sessions} activeSessionKey="meu-projeto::claude-work" projects={projects} />);
    expect(screen.getByText('Claude (Work)')).toBeTruthy();
    expect(screen.getByText('Meu Projeto')).toBeTruthy();
  });
});
