// frontend/src/layouts/v2/AppV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md): teste de integração pendente
// deliberadamente adiado pelo Revisor do Milestone 2 até as 4 telas
// existirem de verdade (ver .planning — Board/Tarefas/Agentes eram
// placeholders até este milestone). Monta <AppV2> de verdade (não <App>: o
// bootstrap assíncrono de fetchAppearance() em main.jsx não faz parte do
// que este teste cobre — App.test.jsx já cobre o roteamento v1/v2 no nível
// acima), navega pelas 4 telas via os itens de nav de SidebarV2, e confirma
// que cada uma renderiza seu conteúdo real — não mais "em construção —
// Milestone 3".
//
// Dependências pesadas mockadas, mesmo padrão de App.test.jsx/
// ChatSidebarV2.test.jsx: TerminalContext (WebSocket real), TerminalPanel
// (xterm.js real), e os 3 hooks de dados (useCards/useGlobalTasks/
// useAgentSettings) que Board/Tarefas/Agentes chamam internamente.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { AppV2 } from './AppV2.jsx';

vi.mock('../../hooks/useProjects.js', () => ({
  useProjects: () => [
    [{ id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'], default: true }], sub_projetos: [] }],
    vi.fn(),
  ],
}));

// mockUseTerminal: a `mock`-prefixed variable is one of the few identifiers
// vitest's hoisting allows a vi.mock() factory (itself hoisted above this
// file's imports) to reference — needed so individual tests below can
// override activeSessionKey (e.g. to assert the "Ajustar layout" button
// becomes enabled once a session is active) without a separate vi.mock per
// test.
const mockUseTerminal = vi.fn(() => ({
  sessions: [],
  activeSessionKey: null,
  selectedProjectId: 'projA',
  selectProject: vi.fn(),
  startSession: vi.fn(),
  startNewInstance: vi.fn(),
  terminateSession: vi.fn(),
  renameSession: vi.fn(),
  activeSessions: {},
  persistedSessions: {},
}));

vi.mock('../../components/TerminalContext.jsx', () => ({
  useTerminal: (...args) => mockUseTerminal(...args),
}));

vi.mock('../../components/TerminalPanel.jsx', () => ({
  TerminalPanel: () => <div data-testid="mock-terminal-panel">terminal</div>,
}));

// `mock`-prefixed (mesmo motivo de mockUseTerminal acima): precisa ser um
// vi.fn() de verdade — não só um objeto de retorno fixo — pra que o bloco
// "BoardV2 segue o cliente da sidebar" abaixo consiga inspecionar COM QUE
// array de projeto_id o hook foi chamado a cada render, sem deixar de servir
// os testes existentes acima (que só olham o texto renderizado, indiferentes
// aos argumentos).
const mockUseCards = vi.fn(() => ({
  cards: [{ id: 1, titulo: 'Card teste', descricao: null, projeto_id: 'projA', status: 'a_fazer', ultima_atualizacao_por: 'bruno' }],
  createCard: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../../hooks/useCards.js', () => ({
  useCards: (...args) => mockUseCards(...args),
}));

vi.mock('../../hooks/useGlobalTasks.js', () => ({
  useGlobalTasks: () => ({
    tasks: [{ id: 1, titulo: 'Tarefa teste', status: 'pending', session_key: 'projA::claude', projeto_id: 'projA', agent_id: 'claude', session_display_name: null }],
    loading: false,
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
  }),
}));

vi.mock('../../hooks/useAgentSettings.js', () => ({
  useAgentSettings: () => ({
    agents: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] }],
    loading: false,
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
  }),
}));

// jsdom não implementa window.matchMedia — useSidebarCollapsed() (chamado
// por AppV2) lê isso de forma síncrona no primeiro render (mesmo shim de
// App.test.jsx).
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // Reset to the default (no active session) before every test — individual
  // tests below override activeSessionKey via mockUseTerminal.mockReturnValue
  // and must not leak that into unrelated tests.
  mockUseTerminal.mockReturnValue({
    sessions: [],
    activeSessionKey: null,
    selectedProjectId: 'projA',
    selectProject: vi.fn(),
    startSession: vi.fn(),
    startNewInstance: vi.fn(),
    terminateSession: vi.fn(),
    renameSession: vi.fn(),
    activeSessions: {},
    persistedSessions: {},
  });
});

afterEach(() => cleanup());

const goTo = (label) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(label, 'i') }));

describe('AppV2 — as 4 telas navegam de verdade (não mais placeholder)', () => {
  it('starts on Chat, with the real ChatSidebarV2 + ChatV2 mounted', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    // ChatSidebarV2's "+ Novo chat" button só existe na tela de Chat.
    expect(screen.getByText('+ Novo chat')).toBeTruthy();
  });

  it('navigating to Board renders BoardV2 with real card data (useCards), not the old placeholder', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Board');
    expect(screen.queryByText(/em construção — Milestone 3/)).toBeNull();
    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Card teste');
  });

  it('navigating to Tarefas renders TarefasV2 with real task data (useGlobalTasks), not the old placeholder', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Tarefas');
    expect(screen.queryByText(/em construção — Milestone 3/)).toBeNull();
    expect(screen.getByText('Tarefa teste')).toBeTruthy();
  });

  it('navigating to Configuração renders ConfiguracaoV2 with real agent data (useAgentSettings), not the old placeholder', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Configuração');
    expect(screen.queryByText(/em construção — Milestone 3/)).toBeNull();
    expect(screen.getByTestId('agentes-v2-card-claude').textContent).toContain('Claude');
  });

  it('navigating back to Chat from another screen re-mounts the real Chat content', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Configuração');
    goTo('Chat');
    expect(screen.getByText('+ Novo chat')).toBeTruthy();
  });
});

// Fase 2 do plano (fix reportado pelo Bruno): BoardV2 passa a seguir o
// CLIENTE selecionado na sidebar (`selectedClienteId`, o mesmo estado já
// repassado a TarefasV2), desacoplado de `selectedProjectId` (o projeto do
// chat ativo em TerminalContext) — mesmo padrão de prop-passing que
// TarefasV2 já tinha. Cobrimos aqui só a EQUIVALÊNCIA "BoardV2 recebe
// selectedClienteId == estado da sidebar"; a lógica de agregação
// cliente+subprojetos em si (a fórmula `[selectedClienteId, ...subs]`) já é
// coberta isoladamente em BoardV2.test.jsx.
describe('AppV2 — BoardV2 segue o cliente selecionado na sidebar (Fase 2, desacoplado do chat ativo)', () => {
  beforeEach(() => { mockUseCards.mockClear(); });

  it('on first render, BoardV2 is filtered by the client derived from the active chat project (lazy-init of selectedClienteId)', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Board');
    // mockUseTerminal (topo do arquivo) tem selectedProjectId: 'projA', que
    // não tem "/" — clienteIdFromProjetoId('projA') === 'projA'.
    expect(mockUseCards).toHaveBeenCalledWith(['projA']);
  });

  it('selecting "Todos" on the sidebar (a board-only, no-op-on-chat action) switches BoardV2 to fetch cards for all projects', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Board');
    expect(mockUseCards).toHaveBeenCalledWith(['projA']);

    // "Todos" na ClienteList da SidebarV2 (desktop) — via `title` (não
    // `getByText`): com "Todos" selecionado, selectedProjectIds vira [] e a
    // tag de projeto do BoardV2 (Fase 2) passa a mostrar "Projeto A" em cada
    // card também, então getByText('Projeto A') mais abaixo colidiria.
    fireEvent.click(screen.getByTitle('Todos'));

    expect(mockUseCards).toHaveBeenLastCalledWith([]);
  });

  it('re-selecting the client on the sidebar switches BoardV2 back to that client\'s cards', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    goTo('Board');
    fireEvent.click(screen.getByTitle('Todos'));
    expect(mockUseCards).toHaveBeenLastCalledWith([]);

    fireEvent.click(screen.getByTitle('Projeto A'));
    expect(mockUseCards).toHaveBeenLastCalledWith(['projA']);
  });
});

// Botão "Ajustar layout" (TL plano — "Renderizar o botão"): só existe na
// tela de Chat, e fica desabilitado sem uma sessão ativa (não há painel pra
// forceFit()ar). O TerminalPanel mockado no topo deste arquivo NÃO é
// forwardRef — anexar um ref a ele emite o warning padrão do React
// ("Function components cannot be given refs"), inofensivo aqui: o que este
// bloco cobre é a visibilidade/estado do BOTÃO em si, não o forceFit()
// (isso já é responsabilidade de ChatV2.test.jsx/TerminalPanel.test.jsx).
describe('AppV2 — botão "Ajustar layout" (Layout v2, só na tela Chat)', () => {
  it('aparece na tela Chat', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByText('↺ Ajustar layout')).toBeTruthy();
  });

  it('fica desabilitado quando não há sessão ativa', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByText('↺ Ajustar layout').disabled).toBe(true);
  });

  it('fica habilitado quando há uma sessão ativa', () => {
    mockUseTerminal.mockReturnValue({
      sessions: [{ sessionKey: 'projA::claude', projectId: 'projA', agentId: 'claude' }],
      activeSessionKey: 'projA::claude',
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: {},
    });

    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);

    expect(screen.getByText('↺ Ajustar layout').disabled).toBe(false);
  });

  it('some ao navegar pra outras telas', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByText('↺ Ajustar layout')).toBeTruthy();

    goTo('Board');
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();

    goTo('Tarefas');
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();

    goTo('Configuração');
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();

    goTo('Chat');
    expect(screen.getByText('↺ Ajustar layout')).toBeTruthy();
  });
});

// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 13): máquina de
// estados `mobileView` ('menu' | 'chatModal' | 'content'), só ativa quando
// `useMediaQuery(MOBILE_VIEWPORT_QUERY)` resolve `true`. Mesmo fabricante de
// MediaQueryList controlável de hooks/useMediaQuery.test.js — reaproveitado
// aqui em vez de duplicado com uma variação própria.
function makeControllableMatchMedia(initialMatches) {
  let matches = initialMatches;
  let changeHandler = null;
  const mql = {
    get matches() { return matches; },
    addEventListener: (event, handler) => { if (event === 'change') changeHandler = handler; },
    removeEventListener: vi.fn(),
  };
  return {
    matchMediaFn: vi.fn(() => mql),
    fireChange: (nextMatches) => {
      matches = nextMatches;
      changeHandler?.({ matches: nextMatches });
    },
  };
}

// Tocar no cliente sempre dentro do MobileMenuScreen: o `content` (BoardV2
// etc.) fica sempre montado por baixo do overlay (invariante do Arquiteto) e
// pode repetir o mesmo texto do nome do cliente (ex: metadado de card no
// Board) — sem escopar pelo testid do menu, `getByText` acharia 2 matches.
const clickClienteNoMenu = (nome) =>
  fireEvent.click(within(screen.getByTestId('mobile-menu-screen')).getByText(nome));

describe('AppV2 — navegação mobile (mobileView, breakpoint MOBILE_VIEWPORT_QUERY)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('inicia no menu mobile (MobileMenuScreen), sem SidebarV2/ChatSidebarV2 de desktop montadas', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();
    // "+ Novo chat" só existe dentro de ChatSidebarV2 (coluna de desktop) —
    // sua ausência aqui confirma que ela não foi montada no mobile.
    expect(screen.queryByText('+ Novo chat')).toBeNull();
  });

  it('inicia direto no conteúdo (não no menu) quando já existe uma sessão ativa restaurada (mobile phone-lock fix)', () => {
    // Reproduz um reload de página com activeSessionKey já restaurado do
    // localStorage (TerminalContext) — mesmo cenário de uma trava longa de
    // celular que descartou a aba: pousar no menu de novo leria como "a
    // sessão acabou" mesmo já reconectada por baixo.
    mockUseTerminal.mockReturnValue({
      sessions: [{ sessionKey: 'projA::claude', projectId: 'projA', agentId: 'claude' }],
      activeSessionKey: 'projA::claude',
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: { 'projA::claude': { display_name: 'Claude' } },
    });
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
    expect(screen.getByTestId('mock-terminal-panel')).toBeTruthy();
    expect(screen.getByText('Menu')).toBeTruthy(); // botão flutuante confirma mobileView==='content'
  });

  it('avança do menu pro conteúdo assim que `sessions` confirma a chave restaurada, sem precisar de um novo mount', () => {
    // Simula o timing real (diferente do teste acima, que já nasce com
    // `sessions` preenchido pelo mock): activeSessionKey chega restaurado do
    // localStorage no 1º render, mas `sessions` só é populado por
    // TerminalContext um instante depois, quando o fetch de restauração
    // resolve — aqui simulado por um re-render com `sessions` atualizado.
    const baseMock = {
      sessions: [],
      activeSessionKey: 'projA::claude',
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: {},
    };
    mockUseTerminal.mockReturnValue(baseMock);
    const { rerender } = render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);

    // Ainda restaurando: fica no menu, não no placeholder vazio do ChatV2.
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();

    mockUseTerminal.mockReturnValue({
      ...baseMock,
      sessions: [{ sessionKey: 'projA::claude', projectId: 'projA', agentId: 'claude' }],
    });
    rerender(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);

    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
    expect(screen.getByTestId('mock-terminal-panel')).toBeTruthy();
  });

  it('permanece no menu (nunca fica preso no placeholder vazio do ChatV2) quando a sessão restaurada não existe nem em active nem em persisted', () => {
    // A chave restaurada do localStorage não volta a aparecer em `sessions`
    // (sessão realmente encerrada, ou chave obsoleta) — sem o guard, o
    // mobileView ficaria parado em 'content' mostrando "Selecione um chat na
    // lista ao lado…", um texto sem sentido no mobile (não existe lista ao
    // lado) e sem saída além do botão flutuante "Menu".
    mockUseTerminal.mockReturnValue({
      sessions: [],
      activeSessionKey: 'projA::claude',
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: {},
    });
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();
    expect(screen.queryByTestId('mock-terminal-panel')).toBeNull();
  });

  it('tap num cliente com a aba Chat ativa abre o chatModal, não vai direto pro conteúdo', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Chats de Projeto A')).toBeTruthy();
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
  });

  it('tap num cliente com a aba Board ativa vai direto pro conteúdo, sem passar por modal', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Board/i }));
    clickClienteNoMenu('Projeto A');
    expect(screen.getByTestId('board-v2-card-1')).toBeTruthy();
    expect(screen.queryByText('Chats de Projeto A')).toBeNull();
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
  });

  it('tap num cliente com a aba Tarefas ativa vai direto pro conteúdo, sem passar por modal (RF07)', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Tarefas/i }));
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Tarefa teste')).toBeTruthy();
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
  });

  it('tap num cliente com a aba Configuração ativa vai direto pro conteúdo, sem passar por modal (RF08)', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Configuração/i }));
    clickClienteNoMenu('Projeto A');
    expect(screen.getByTestId('agentes-v2-card-claude')).toBeTruthy();
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
  });

  it('selecionar um chat no chatModal fecha o modal e mostra o conteúdo com o botão flutuante', () => {
    mockUseTerminal.mockReturnValue({
      sessions: [],
      activeSessionKey: null,
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: { 'projA::claude': { display_name: 'Claude' } },
    });
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    fireEvent.click(screen.getByText('Claude'));
    expect(screen.getByText('Menu')).toBeTruthy();
    expect(screen.queryByText('Chats de Projeto A')).toBeNull();
  });

  it('fechar o chatModal sem escolher (scrim) volta pro menu', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    fireEvent.click(screen.getByTestId('bottom-sheet-scrim'));
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();
  });

  it('botão flutuante sempre volta pro menu preservando a aba ativa (reabre o mesmo chatModal ao tocar de novo no cliente)', () => {
    mockUseTerminal.mockReturnValue({
      sessions: [],
      activeSessionKey: null,
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: { 'projA::claude': { display_name: 'Claude' } },
    });
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    fireEvent.click(screen.getByText('Claude'));

    fireEvent.click(screen.getByText('Menu'));
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();

    // v2Screen continua 'chat' (não foi resetado) — tocar no cliente de novo
    // reabre o chatModal, em vez de ir direto pro conteúdo como aconteceria
    // se a aba ativa tivesse sido perdida.
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Chats de Projeto A')).toBeTruthy();
  });

  it('sair do mobile com o chatModal aberto reseta mobileView pra menu (SidebarV2/ChatSidebarV2 de desktop voltam)', () => {
    const { matchMediaFn, fireChange } = makeControllableMatchMedia(true);
    window.matchMedia = matchMediaFn;

    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Chats de Projeto A')).toBeTruthy();

    act(() => fireChange(false));

    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
    expect(screen.queryByText('Chats de Projeto A')).toBeNull();
    expect(screen.getByText('+ Novo chat')).toBeTruthy();
  });
});

// QA (etapa 8): lacuna registrada em CONTEXTO.md — "só há teste para
// useMediaQuery/ResetLayoutButton, nenhum para MobileMenuScreen/
// MobileChatSheet no papel de navegação mobile em si" (a parte de
// ResetLayoutButton em si já tinha teste, mas nunca sua AUSÊNCIA condicional
// no mobile, que é lógica só de AppV2.jsx — `!isMobile && v2Screen ===
// 'chat'` — não do componente ResetLayoutButton isolado).
describe('AppV2 — botão "Ajustar layout" nunca aparece no mobile (integração com ResetLayoutButton)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('ausente em mobileView="menu" (estado inicial)', () => {
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();
  });

  it('ausente em mobileView="chatModal"', () => {
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Chats de Projeto A')).toBeTruthy();
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();
  });

  it('ausente em mobileView="content" (mesmo com uma sessão ativa, que habilitaria o botão no desktop)', () => {
    mockUseTerminal.mockReturnValue({
      sessions: [],
      activeSessionKey: null,
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: { 'projA::claude': { display_name: 'Claude' } },
    });
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    fireEvent.click(screen.getByText('Claude'));
    expect(screen.getByText('Menu')).toBeTruthy(); // confirma que chegou em 'content'
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();
  });

  it('reaparece (e reflete o estado real da sessão ativa) ao sair do mobile', () => {
    const { matchMediaFn, fireChange } = makeControllableMatchMedia(true);
    window.matchMedia = matchMediaFn;
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.queryByText('↺ Ajustar layout')).toBeNull();

    act(() => fireChange(false));

    expect(screen.getByText('↺ Ajustar layout')).toBeTruthy();
  });
});

// QA (etapa 8): invariante arquitetural documentado em CONTEXTO.md seção 2/4
// — "nenhuma navegação [mobile] pode desmontar este <ChatV2>" — já corrigido
// duas vezes como bug (uma delas quase reintroduzida "por fork de árvore por
// breakpoint" durante o desenho desta própria feature). Este describe prova
// a persistência por IDENTIDADE de nó DOM (não só por texto/testid reaparecer
// — reaparecer poderia ser uma remontagem com o mesmo texto): se `mobileView`
// algum dia desmontar `<ChatV2>` (ex.: um `isMobile && mobileView ===
// 'content' && <ChatV2/>` colado ao lado do bloco `content` por engano), o
// nó capturado ANTES deixaria de ser `===` ao nó relido DEPOIS, e o teste
// pegaria a regressão mesmo sem simular um chat com >64KB de scrollback real.
describe('AppV2 — invariante: TerminalPanel (ChatV2) nunca desmonta durante transições de mobileView', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
    mockUseTerminal.mockReturnValue({
      // `sessions` (não só `persistedSessions`) precisa ter a entrada ATIVA
      // desde o início: ChatV2.jsx só monta um <TerminalPanel> por item de
      // `sessions` — sem isso, ChatV2 renderiza o placeholder "Selecione um
      // chat..." em vez do TerminalPanel mockado, e não haveria nó nenhum
      // para capturar como `initialNode` já no primeiro render.
      sessions: [{ sessionKey: 'projA::claude', projectId: 'projA', agentId: 'claude' }],
      activeSessionKey: 'projA::claude',
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance: vi.fn(),
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: { 'projA::claude': { display_name: 'Claude' } },
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('o mesmo nó DOM do TerminalPanel mockado persiste ao navegar content -> menu -> chatModal -> content -> menu -> chatModal de novo', () => {
    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);

    // Estado inicial é 'content' quando já existe uma sessão ativa (mobile
    // phone-lock fix, confirmado pelo Bruno): um reload com
    // activeSessionKey já restaurado do localStorage pousa direto no chat,
    // não no menu. ChatV2/TerminalPanel já estão montados desde o primeiro
    // render — é essa presença que ancora a comparação de identidade abaixo.
    const initialNode = screen.getByTestId('mock-terminal-panel');

    fireEvent.click(screen.getByText('Menu')); // content -> menu (botão flutuante)
    expect(screen.getByTestId('mock-terminal-panel')).toBe(initialNode);

    clickClienteNoMenu('Projeto A'); // menu -> chatModal
    expect(screen.getByTestId('mock-terminal-panel')).toBe(initialNode);

    // Escopado ao painel do chatModal: com uma sessão já ATIVA (necessária
    // pra o TerminalPanel mockado existir desde o início, ver beforeEach),
    // o header de ChatV2 já mostra "Claude" também — sem escopar,
    // getByText('Claude') seria ambíguo entre o header e a linha do chat
    // dentro do bottom sheet.
    fireEvent.click(within(screen.getByTestId('bottom-sheet-panel')).getByText('Claude')); // chatModal -> content
    expect(screen.getByTestId('mock-terminal-panel')).toBe(initialNode);

    fireEvent.click(screen.getByText('Menu')); // content -> menu (botão flutuante) de novo
    expect(screen.getByTestId('mock-terminal-panel')).toBe(initialNode);

    clickClienteNoMenu('Projeto A'); // menu -> chatModal de novo
    expect(screen.getByTestId('mock-terminal-panel')).toBe(initialNode);
  });
});

// QA (etapa 8): achado do Revisor na aprovação-com-ressalvas da feature —
// "ausência de teste de integração dedicado para 'criar novo chat' a partir
// do modal mobile (assinatura confirmada compatível, só sem teste)". Este
// describe fecha essa lacuna especificamente no nível de integração AppV2
// (o contrato isolado de MobileChatSheet/NewChatSheet já é coberto por
// MobileChatSheet.test.jsx) — o que só AppV2 pode provar é a ligação real
// com `startNewInstance` do TerminalContext e a transição de `mobileView`
// para 'content' ao terminar.
describe('AppV2 — "criar novo chat" a partir do modal mobile chega até startNewInstance (achado do Revisor)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeControllableMatchMedia(true).matchMediaFn;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('escolher agente e submeter no NewChatSheet chama startNewInstance(projetoId, agentId) e fecha pro conteúdo', () => {
    const startNewInstance = vi.fn();
    mockUseTerminal.mockReturnValue({
      sessions: [],
      activeSessionKey: null,
      selectedProjectId: 'projA',
      selectProject: vi.fn(),
      startSession: vi.fn(),
      startNewInstance,
      terminateSession: vi.fn(),
      renameSession: vi.fn(),
      activeSessions: {},
      persistedSessions: {},
    });

    render(<AppV2 initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    clickClienteNoMenu('Projeto A');
    expect(screen.getByText('Chats de Projeto A')).toBeTruthy();

    // 'Projeto A' não tem chats abertos -> MobileChatSheet mostra o estado
    // vazio, com o botão "+ Novo chat" em destaque ALÉM do fixo no footer;
    // qualquer um dos dois abre o mesmo NewChatSheet.
    fireEvent.click(screen.getAllByText('+ Novo chat')[0]);
    expect(screen.getByText('Novo chat em Projeto A')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));

    expect(startNewInstance).toHaveBeenCalledWith('projA', 'claude');
    // handleMobileStartNewChat fecha pro conteúdo (mobileView='content') —
    // nem o menu nem o modal de chats continuam na tela.
    expect(screen.queryByTestId('mobile-menu-screen')).toBeNull();
    expect(screen.queryByText('Chats de Projeto A')).toBeNull();
    expect(screen.getByText('Menu')).toBeTruthy();
  });
});
