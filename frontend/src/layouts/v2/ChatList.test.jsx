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
