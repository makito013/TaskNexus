// frontend/src/layouts/v2/ChatList.test.jsx
// QA (retrabalho pontual — avatares no modo recolhido, pedido literal do
// Bruno): cobre o contrato isolado do `collapsed` em ChatList.jsx, que antes
// só era exercitado indiretamente via ChatSidebarV2.test.jsx (que testava
// ausência de texto/testids de grupo, não a presença dos avatares que agora
// substituem nome/meta/botão de fechar). Fecha essa lacuna: clique no avatar
// recolhido de um chat continua selecionando a sessão certa, o anel
// "rodando" (.v2-chat-avatar--running) sobrevive ao modo recolhido, e o item
// ativo mantém destaque visual mesmo sem o corpo de texto.
//
// MobileChatSheet.jsx (fora de escopo desta rodada) usa <ChatList/> sem
// passar `collapsed` — o default `collapsed = false` cobre esse caso, não
// exercitado aqui de propósito.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ChatList } from './ChatList.jsx';

vi.mock('../../hooks/useAgentSettings.js', () => ({
  useAgentSettings: vi.fn(),
}));

import { useAgentSettings } from '../../hooks/useAgentSettings.js';

const GLOBAL_AGENTS_FIXTURE = {
  agents: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] }],
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

const projects = [
  { id: 'meu-projeto', nome: 'Meu Projeto', path: '/tmp/meu-projeto', agentes: [], sub_projetos: [] },
];

const persistedSessions = {
  'meu-projeto::claude': { display_name: null, needs_attention: false },
};

function baseProps(overrides = {}) {
  return {
    projects,
    activeSessionKey: null,
    activeSessions: {},
    persistedSessions,
    selectedClienteId: 'meu-projeto',
    onSelectChat: vi.fn(),
    onRenameChat: noop,
    onCloseChat: noop,
    selectedCliente: projects[0],
    collapsed: true,
    ...overrides,
  };
}

describe('ChatList — collapsed=true (avatares no lugar do nome/meta/fechar)', () => {
  it('esconde o corpo (nome+meta) e o botão de fechar, mas mantém o avatar do chat', () => {
    render(<ChatList {...baseProps()} />);
    expect(screen.queryByText('Claude')).toBeNull();
    expect(screen.queryByText('Raiz')).toBeNull();
    expect(screen.queryByLabelText(/Encerrar/)).toBeNull();
    expect(document.querySelectorAll('.v2-chat-avatar')).toHaveLength(1);
  });

  it('avatar recolhido tem title com o label do chat (tooltip nativo no lugar do texto)', () => {
    render(<ChatList {...baseProps()} />);
    const avatar = document.querySelector('.v2-chat-avatar');
    expect(avatar.getAttribute('title')).toBe('Claude');
    expect(avatar.textContent).toBe('C');
  });

  it('clicar no avatar recolhido de um chat chama onSelectChat com o chat certo', () => {
    const onSelectChat = vi.fn();
    render(<ChatList {...baseProps({ onSelectChat })} />);
    fireEvent.click(document.querySelector('.v2-chat-avatar'));
    expect(onSelectChat).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'meu-projeto::claude', projectId: 'meu-projeto', agentId: 'claude' })
    );
  });

  it('mantém .v2-chat-avatar--running quando a sessão está rodando E a coluna está recolhida', () => {
    render(
      <ChatList
        {...baseProps({ activeSessions: { 'meu-projeto::claude': { status: 'running' } } })}
      />
    );
    const avatar = document.querySelector('.v2-chat-avatar');
    expect(avatar.classList.contains('v2-chat-avatar--running')).toBe(true);
  });

  it('item ativo mantém o destaque visual (background) mesmo recolhido, sem o texto', () => {
    render(<ChatList {...baseProps({ activeSessionKey: 'meu-projeto::claude' })} />);
    const avatar = document.querySelector('.v2-chat-avatar');
    const row = avatar.parentElement;
    expect(row.style.background).toBe('var(--v2-surface-2)');
  });

  it('item inativo não tem o destaque visual quando recolhido', () => {
    render(<ChatList {...baseProps({ activeSessionKey: null })} />);
    const avatar = document.querySelector('.v2-chat-avatar');
    const row = avatar.parentElement;
    expect(row.style.background).toBe('transparent');
  });

  it('em modo "Todos" (agrupado), esconde o groupLabel de texto mas mantém os avatares dos chats', () => {
    render(<ChatList {...baseProps({ selectedClienteId: null })} />);
    expect(screen.queryByTestId('chat-group-label-meu-projeto')).toBeNull();
    expect(screen.getByTestId('chat-group-meu-projeto')).toBeTruthy();
    expect(document.querySelectorAll('.v2-chat-avatar')).toHaveLength(1);
  });

  it('estado vazio (sem chats) não renderiza nada quando recolhido (sem espaço pro texto)', () => {
    const { container } = render(<ChatList {...baseProps({ persistedSessions: {} })} />);
    expect(container.querySelector('.v2-chat-avatar')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('ChatList — collapsed=false (comportamento original preservado)', () => {
  it('mostra nome, meta e botão de fechar normalmente', () => {
    render(<ChatList {...baseProps({ collapsed: false })} />);
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Raiz')).toBeTruthy();
    expect(screen.getByLabelText('Encerrar Claude')).toBeTruthy();
  });
});

// Rodada "Novo chat em modal" (Bloco 6, Tarefa 15/16): resolveRowMeta agora
// usa relativeProjectPath/truncatePathMeta pra profundidade >= 2 (2+
// segmentos abaixo do cliente), com truncamento pela CABEÇA e `title` na
// linha inteira com o caminho completo (nunca truncado). Profundidade 0
// ("Raiz") e 1 (nome do sub-projeto) ficam cobertas pelos 2 describes acima,
// inalteradas.
describe('ChatList — meta de profundidade >= 2 (truncatePathMeta + title)', () => {
  const deepProjects = [
    { id: 'meu-projeto', nome: 'Meu Projeto', path: '/tmp/meu-projeto', agentes: [] },
    { id: 'meu-projeto/gateway', nome: 'gateway', path: '/tmp/meu-projeto/gateway', agentes: [], elegivel: false },
    { id: 'meu-projeto/gateway/sub', nome: 'sub', path: '/tmp/meu-projeto/gateway/sub', agentes: [], elegivel: true },
    {
      id: 'meu-projeto/principal/apps/podesubir-guardapp-rn',
      nome: 'podesubir-guardapp-rn',
      path: '/tmp/meu-projeto/principal/apps/podesubir-guardapp-rn',
      agentes: [],
      elegivel: true,
    },
  ];

  it('profundidade 2 (2 segmentos abaixo do cliente): mostra o caminho relativo inteiro, sem truncar', () => {
    const persisted = { 'meu-projeto/gateway/sub::claude': { display_name: null } };
    render(
      <ChatList
        {...baseProps({ collapsed: false, projects: deepProjects, persistedSessions: persisted, selectedCliente: deepProjects[0] })}
      />
    );
    expect(screen.getByText('gateway / sub')).toBeTruthy();
  });

  it('profundidade 3 (3+ segmentos): trunca pela CABEÇA, preservando os últimos 2 segmentos', () => {
    const persisted = { 'meu-projeto/principal/apps/podesubir-guardapp-rn::claude': { display_name: null } };
    render(
      <ChatList
        {...baseProps({ collapsed: false, projects: deepProjects, persistedSessions: persisted, selectedCliente: deepProjects[0] })}
      />
    );
    expect(screen.getByText('… / apps / podesubir-guardapp-rn')).toBeTruthy();
  });

  it('a linha carrega title com o caminho COMPLETO (não truncado), mesmo quando o texto visível está truncado', () => {
    const persisted = { 'meu-projeto/principal/apps/podesubir-guardapp-rn::claude': { display_name: null } };
    render(
      <ChatList
        {...baseProps({ collapsed: false, projects: deepProjects, persistedSessions: persisted, selectedCliente: deepProjects[0] })}
      />
    );
    const row = screen.getByText('… / apps / podesubir-guardapp-rn').closest('[title]');
    expect(row.getAttribute('title')).toBe('principal / apps / podesubir-guardapp-rn');
  });

  it('a cor do meta da linha é --v2-text-dim (correção WCAG 1.4.3, antes --v2-text-faint)', () => {
    render(<ChatList {...baseProps({ collapsed: false })} />);
    const meta = screen.getByText('Raiz');
    expect(meta.style.color).toBe('var(--v2-text-dim)');
  });
});

// Fase N: com um projeto escolhido na sidebar, a lista do cliente encolhe para
// a subárvore dele (3 níveis inclusive); "Raiz" mostra só a pasta do cliente.
describe('ChatList — filtro pelo projeto da sidebar (Fase N)', () => {
  const tree = [
    { id: 'pode', nome: 'pode', elegivel: true },
    { id: 'pode/site', nome: 'site', elegivel: true },
    { id: 'pode/api', nome: 'api', elegivel: false },
    { id: 'pode/api/v2', nome: 'v2', elegivel: true },
    { id: 'pode/api2', nome: 'api2', elegivel: true },
  ];
  const sessions = {
    'pode::claude': { display_name: 'Chat raiz' },
    'pode/site::claude': { display_name: 'Chat site' },
    'pode/api/v2::claude': { display_name: 'Chat v2' },
    'pode/api2::claude': { display_name: 'Chat api2' },
  };
  const props = (overrides) => baseProps({
    projects: tree,
    persistedSessions: sessions,
    selectedClienteId: 'pode',
    selectedCliente: tree[0],
    collapsed: false,
    ...overrides,
  });
  const labels = () => Array.from(document.querySelectorAll('.v2-chat-avatar')).map((a) => a.parentElement.textContent);

  it('sem projeto: todos os chats do cliente, como antes', () => {
    render(<ChatList {...props({ selectedProjetoId: null })} />);
    expect(screen.getByText('Chat raiz')).toBeTruthy();
    expect(screen.getByText('Chat v2')).toBeTruthy();
    expect(labels()).toHaveLength(4);
  });

  it('projeto com filhos: ele e a subárvore (neto incluído), sem o irmão de nome parecido', () => {
    render(<ChatList {...props({ selectedProjetoId: 'pode/api' })} />);
    expect(screen.getByText('Chat v2')).toBeTruthy();
    expect(screen.queryByText('Chat api2')).toBeNull();
    expect(screen.queryByText('Chat raiz')).toBeNull();
    expect(screen.queryByText('Chat site')).toBeNull();
  });

  it('Raiz: só os chats presos na pasta do próprio cliente', () => {
    render(<ChatList {...props({ selectedProjetoId: 'pode' })} />);
    expect(screen.getByText('Chat raiz')).toBeTruthy();
    expect(labels()).toHaveLength(1);
  });

  it('estado vazio nomeia o escopo inteiro ("cliente / projeto")', () => {
    render(<ChatList {...props({ persistedSessions: { 'pode::claude': {} }, selectedProjetoId: 'pode/site' })} />);
    expect(screen.getByText(/Nenhum chat aberto para pode \/ site\./)).toBeTruthy();
  });
});
