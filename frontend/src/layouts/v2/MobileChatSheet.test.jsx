// frontend/src/layouts/v2/MobileChatSheet.test.jsx
// QA (etapa 8, navegação mobile do Layout v2 — lacuna registrada em
// CONTEXTO.md seção 6: "só há teste para useMediaQuery/ResetLayoutButton,
// nenhum para MobileMenuScreen/MobileChatSheet no papel de navegação mobile
// em si"). Cobre MobileChatSheet.jsx ISOLADO (sem montar AppV2 inteiro):
// título dinâmico (cliente selecionado / "Todos" / cliente órfão), delegação
// para ChatList (seleção de chat), o estado vazio custom (ícone + botão, via
// renderEmptyState de ChatList), o contrato de disabled/title de "+ Novo
// chat", e — o achado do Revisor que ficou pendente sem teste na rodada
// anterior — o fluxo "criar novo chat" completo a partir do modal mobile
// (abre NewChatSheet, submete, chama onStartNewChat com os args certos).
//
// Também cobre o caso das DUAS BottomSheet empilhadas (MobileChatSheet +
// NewChatSheet aninhado) e o mecanismo de `escapeEnabled` que evita um único
// ESC fechando as duas de uma vez — ver comentário no topo de
// BottomSheet.jsx e de MobileChatSheet.jsx.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MobileChatSheet } from './MobileChatSheet.jsx';

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

// O botão "+ Novo chat" pode aparecer DUAS vezes ao mesmo tempo: o fixo do
// footer (`fixedFooter`, sempre presente) e o de destaque dentro do estado
// vazio de ChatList (`renderEmptyState`, só quando o cliente selecionado não
// tem chats abertos). getByText('+ Novo chat') sozinho é ambíguo nesse caso
// — este helper sempre pega o do FOOTER (ordem de DOM: header, scrollArea
// com a lista/estado vazio, footer por último), que é o único elemento com
// contrato estável de disabled/title testado abaixo.
function getFooterNewChatButton() {
  const matches = screen.getAllByText('+ Novo chat');
  return matches[matches.length - 1].closest('button');
}

const clienteComSub = {
  id: 'cliente_projeto_1',
  nome: 'Cliente 1',
  path: '/tmp/cliente_projeto_1',
  agentes: [],
  sub_projetos: ['cliente_projeto_1/subprojeto_1'],
};

const clienteSemSub = {
  id: 'podesubir',
  nome: 'Pode Subir',
  path: '/tmp/podesubir',
  agentes: [],
  sub_projetos: [],
};

const projects = [clienteComSub, clienteSemSub];

function baseProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    projects,
    activeSessionKey: null,
    activeSessions: {},
    persistedSessions: {},
    selectedClienteId: 'cliente_projeto_1',
    onSelectChat: vi.fn(),
    onRenameChat: noop,
    onCloseChat: noop,
    onStartNewChat: vi.fn(),
    ...overrides,
  };
}

describe('MobileChatSheet — visibilidade', () => {
  it('open=false: não renderiza nada (BottomSheet retorna null)', () => {
    render(<MobileChatSheet {...baseProps({ open: false })} />);
    expect(screen.queryByTestId('bottom-sheet-scrim')).toBeNull();
  });

  it('open=true: renderiza o painel', () => {
    render(<MobileChatSheet {...baseProps()} />);
    expect(screen.getByTestId('bottom-sheet-panel')).toBeTruthy();
  });

  it('clicar no scrim chama onClose', () => {
    const onClose = vi.fn();
    render(<MobileChatSheet {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bottom-sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Confirma a fiação real dos props aditivos de BottomSheet.jsx (Tarefa 4)
  // que MobileChatSheet.jsx passa — maxHeightVh=68 (sheet mais baixo que o
  // padrão 85vh) e fixedFooter (painel para de rolar como um todo; a área
  // rolável fica só dentro de <ChatList/>). BottomSheet.test.jsx já cobre o
  // CONTRATO genérico dessas props; isto aqui garante que MobileChatSheet.jsx
  // de fato as usa com os valores documentados em seu próprio cabeçalho.
  it('passa maxHeightVh=68 e fixedFooter=true pro BottomSheet (contrato documentado no cabeçalho do arquivo)', () => {
    render(<MobileChatSheet {...baseProps()} />);
    const panel = screen.getByTestId('bottom-sheet-panel');
    expect(panel.style.maxHeight).toBe('68vh');
    expect(panel.style.overflow).toBe('hidden');
  });
});

describe('MobileChatSheet — título dinâmico', () => {
  it('cliente específico selecionado: "Chats de {nome}"', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    expect(screen.getByText('Chats de Cliente 1')).toBeTruthy();
  });

  it('nenhum cliente selecionado (Todos): "Todos os chats"', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: null })} />);
    expect(screen.getByText('Todos os chats')).toBeTruthy();
  });

  it('cliente órfão (selecionado mas ausente de `projects`): "Cliente não encontrado"', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente-removido' })} />);
    expect(screen.getByText('Cliente não encontrado')).toBeTruthy();
  });
});

describe('MobileChatSheet — lista de chats (delegação para ChatList)', () => {
  it('mostra os chats abertos do cliente selecionado e seleção chama onSelectChat', () => {
    const onSelectChat = vi.fn();
    render(
      <MobileChatSheet
        {...baseProps({
          onSelectChat,
          persistedSessions: { 'cliente_projeto_1::claude': { display_name: null } },
        })}
      />
    );
    fireEvent.click(screen.getByText('Claude'));
    expect(onSelectChat).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'cliente_projeto_1::claude', projectId: 'cliente_projeto_1', agentId: 'claude' })
    );
  });

  it('estado vazio custom (ícone 💬 + texto + botão "+ Novo chat" em destaque), não o texto simples de ChatSidebarV2', () => {
    render(<MobileChatSheet {...baseProps({ persistedSessions: {} })} />);
    expect(screen.getByText(/Nenhum chat aberto ainda em Cliente 1/)).toBeTruthy();
    // Duas ocorrências de "+ Novo chat": o botão de destaque do estado vazio
    // + o botão fixo do footer.
    expect(screen.getAllByText('+ Novo chat').length).toBeGreaterThanOrEqual(2);
  });
});

describe('MobileChatSheet — botão "+ Novo chat" (footer fixo)', () => {
  it('habilitado com um cliente válido selecionado', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    const btn = getFooterNewChatButton();
    expect(btn.disabled).toBe(false);
  });

  it('habilitado em modo "Todos" (nenhum cliente selecionado), com tooltip de "escolha o cliente"', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: null })} />);
    const btn = getFooterNewChatButton();
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/escolha o cliente/);
  });

  it('desabilitado quando o cliente selecionado é órfão (não existe em `projects`)', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente-removido' })} />);
    const btn = getFooterNewChatButton();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/não encontrado em projects/i);
  });

  it('clicar no botão desabilitado (cliente órfão) não abre o NewChatSheet nem quebra', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente-removido' })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.queryByText(/^Novo chat em/)).toBeNull();
  });
});

describe('MobileChatSheet — "criar novo chat" em modo "Todos" (select de Cliente dentro do sheet)', () => {
  it('clicar em "+ Novo chat" em "Todos" abre o sheet com título genérico e select de Cliente', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: null })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat')).toBeTruthy();
    expect(screen.getByLabelText('Cliente')).toBeTruthy();
  });

  it('escolher um cliente no picker e submeter chama onStartNewChat(clienteEscolhido.id, agentId)', () => {
    const onStartNewChat = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: null, onStartNewChat })} />);
    fireEvent.click(getFooterNewChatButton());
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1', 'claude');
  });
});

// Achado do Revisor (feature de navegação mobile, aprovada com ressalvas
// não-bloqueantes): "ausência de teste de integração dedicado para 'criar
// novo chat' a partir do modal mobile (assinatura confirmada compatível, só
// sem teste)". Este describe fecha essa lacuna.
describe('MobileChatSheet — "criar novo chat" (fluxo completo, achado do Revisor sem teste até aqui)', () => {
  it('abre o NewChatSheet ao tocar em "+ Novo chat"', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();
  });

  it('submeter sem escolher subprojeto chama onStartNewChat(cliente.id, agentId)', () => {
    const onStartNewChat = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onStartNewChat })} />);
    fireEvent.click(getFooterNewChatButton());
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1', 'claude');
  });

  it('submeter com um subprojeto escolhido chama onStartNewChat(subProjetoId, agentId)', () => {
    const onStartNewChat = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onStartNewChat })} />);
    fireEvent.click(getFooterNewChatButton());
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onStartNewChat).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('cliente sem subprojetos: não mostra o select de projeto, só o aviso de que abre na raiz', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'podesubir' })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/não tem subprojetos/)).toBeTruthy();
  });

  it('fechar o NewChatSheet pelo botão "Cancelar" volta pro MobileChatSheet ainda aberto (sheets independentes)', () => {
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    // O MobileChatSheet (sheet externo) continua montado por baixo.
    expect(screen.getByText('Chats de Cliente 1')).toBeTruthy();
  });
});

// Caso de borda explícito pedido no escopo desta rodada de QA: duas
// BottomSheet empilhadas (MobileChatSheet por baixo, NewChatSheet por cima)
// não podem deixar um único ESC fechar as duas ao mesmo tempo.
describe('MobileChatSheet — duas BottomSheet empilhadas (escapeEnabled) não conflitam no ESC', () => {
  it('com o NewChatSheet aberto por cima, ESC fecha SÓ o NewChatSheet (MobileChatSheet continua aberto)', () => {
    const onClose = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose })} />);
    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    // NewChatSheet fechou...
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    // ...mas o MobileChatSheet (sheet externo) NÃO — seu onClose não foi
    // chamado, e seu conteúdo (título) continua na tela.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Chats de Cliente 1')).toBeTruthy();
  });

  it('depois do NewChatSheet fechar, um novo ESC volta a fechar o MobileChatSheet normalmente (escapeEnabled reabilitado)', () => {
    const onClose = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose })} />);
    fireEvent.click(getFooterNewChatButton());
    fireEvent.keyDown(window, { key: 'Escape' }); // fecha o NewChatSheet
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' }); // agora fecha o MobileChatSheet

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sem nenhum NewChatSheet aberto, ESC fecha o MobileChatSheet normalmente (comportamento de sheet único preservado)', () => {
    const onClose = vi.fn();
    render(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Achado da Segurança (etapa 9, retrabalho pontual): fechar o MobileChatSheet
// "por fora" (prop `open` indo pra `false` — ex. rotação cruzando o breakpoint
// mobile enquanto o NewChatSheet está aberto por cima) não resetava o state
// interno `newChatSheetOpen`, já que esta instância de MobileChatSheet
// continua montada por AppV2.jsx (só o BottomSheet interno retorna null).
// Reabrir o modal fazia o NewChatSheet reaparecer sozinho, com
// `escapeEnabled={!newChatSheetOpen}` preso em `false` (ESC parava de fechar
// o sheet externo).
describe('MobileChatSheet — reset do NewChatSheet ao fechar "por fora" (prop open=false)', () => {
  it('fechar via open=false com o NewChatSheet aberto e reabrir via open=true: NewChatSheet não reaparece sozinho, e ESC volta a fechar o MobileChatSheet (escapeEnabled reabilitado)', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose })} />
    );

    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();

    // Fecha "por fora" — prop `open` transiciona para `false`, não um clique
    // no scrim/handle/ESC do próprio MobileChatSheet.
    rerender(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose, open: false })} />);
    expect(screen.queryByTestId('bottom-sheet-panel')).toBeNull();

    // Reabre.
    rerender(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', onClose, open: true })} />);

    // NewChatSheet NÃO reaparece sozinho por cima.
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    expect(screen.getByText('Chats de Cliente 1')).toBeTruthy();

    // escapeEnabled voltou a `true`: ESC fecha o MobileChatSheet normalmente.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Segunda via de desmontagem abrupta (achado do Analista, retrabalho):
// o wrapper `{!clienteOrfao ? <NewChatSheet/> : null}` desmonta o
// NewChatSheet quando o cliente selecionado fica ÓRFÃO (removido de
// `projects` depois de selecionado) enquanto `open` continua `true`. Esse
// caminho não passava pelo guard de `open` acima, então `newChatSheetOpen`
// sobrevivia e o sheet reaparecia sozinho quando o cliente voltasse a ser
// válido. Nota: desselecionar pra "Todos" NÃO passa mais por esse guard —
// "Todos" virou um alvo válido do sheet (modo "escolher cliente"), não um
// estado órfão — ver describe dedicado acima.
describe('MobileChatSheet — reset do NewChatSheet quando o cliente selecionado fica órfão (open continua true)', () => {
  it('cliente selecionado vira órfão (removido de `projects`) e depois volta a existir: NewChatSheet não reaparece sozinho', () => {
    const { rerender } = render(
      <MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />
    );

    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();

    // `selectedClienteId` continua 'cliente_projeto_1', mas o cliente some de
    // `projects` (ex.: projeto removido/renomeado) — `open` nunca muda.
    rerender(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', projects: [] })} />);
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    expect(screen.getByText('Cliente não encontrado')).toBeTruthy();

    // `projects` volta a incluir o cliente — sem o fix, o NewChatSheet
    // reapareceria aberto sozinho aqui.
    rerender(<MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1', projects })} />);
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    expect(screen.getByText('Chats de Cliente 1')).toBeTruthy();
  });

  it('cliente é desselecionado (selectedClienteId vira null): sheet continua aberto, agora em modo "Todos" (escolher cliente) — não é mais um caso de "órfão" desde que "Todos" passou a ser um alvo válido', () => {
    const { rerender } = render(
      <MobileChatSheet {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />
    );

    fireEvent.click(getFooterNewChatButton());
    expect(screen.getByText('Novo chat em Cliente 1')).toBeTruthy();

    // Desseleciona o cliente (modo "Todos") sem fechar o MobileChatSheet: o
    // NewChatSheet não fecha mais sozinho (não é mais um estado inválido),
    // só troca pro título genérico com o select de Cliente.
    rerender(<MobileChatSheet {...baseProps({ selectedClienteId: null })} />);
    expect(screen.queryByText('Novo chat em Cliente 1')).toBeNull();
    expect(screen.getByText('Novo chat')).toBeTruthy();
    expect(screen.getByLabelText('Cliente')).toBeTruthy();
  });
});
