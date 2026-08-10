// frontend/src/App.test.jsx
// Tarefa 17 (05-TL.md) — smoke test do roteamento client-side plugado em
// App.jsx (useRoute + AppLauncherHeader + branch de 3 vias).
//
// Decisão de isolamento (documentada conforme autorizado pela própria
// especificação da Tarefa 17): `MainLayout` NÃO é um módulo separado — é uma
// função definida dentro do próprio App.jsx, então não existe um caminho de
// import para `vi.mock('./MainLayout.jsx')`. Para isolar a lógica de
// roteamento sem depender da árvore inteira de MainLayout (Sidebar real,
// WebSocket real via TerminalContext, xterm.js, polling de useTasks/api),
// mockamos as PEÇAS que MainLayout importa e consome (Sidebar, TasksDrawer,
// TerminalContext, useTasks, api) — o efeito prático é o mesmo de mockar
// MainLayout diretamente: MainLayout roda de verdade (é código real, não
// mock), mas cada dependência pesada responde com um stub previsível.
// `Sidebar` é renderizada incondicionalmente por MainLayout (App.jsx, linha
// ~124), então seu stub serve de marcador único de "MainLayout renderizou".
//
// BoardView/TarefasGlobalView não são mockadas — são os próprios esqueletos
// triviais criados nesta tarefa (sem dependências pesadas), então rodam reais.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./services/api.js', () => ({
  api: {
    fetchProjects: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./components/TerminalContext.jsx', () => ({
  TerminalProvider: ({ children }) => children,
  useTerminal: () => ({
    sessions: [],
    activeSessionKey: null,
    selectedProjectId: null,
    selectProject: vi.fn(),
    startSession: vi.fn(),
    startNewInstance: vi.fn(),
    terminateSession: vi.fn(),
    renameSession: vi.fn(),
    activeSessions: [],
    persistedSessions: [],
  }),
}));

vi.mock('./hooks/useTasks.js', () => ({
  useTasks: () => ({
    tasksBySession: {},
    pendingCounts: {},
    drawerOpen: false,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    createTask: vi.fn(),
    completeTask: vi.fn(),
    uncompleteTask: vi.fn(),
    continueSession: vi.fn(),
  }),
}));

// TarefasGlobalView (Tarefa 28) is real now (no longer a placeholder) and
// calls useGlobalTasks() itself — mock it to an empty/loaded state so this
// routing smoke test doesn't depend on a real GET /api/tasks/global fetch.
vi.mock('./hooks/useGlobalTasks.js', () => ({
  useGlobalTasks: () => ({
    tasks: [],
    loading: false,
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
  }),
}));

// BoardView (Tarefa 26) is real now (no longer a placeholder) and calls
// useCards() itself — mock it to an empty state so this routing smoke test
// doesn't depend on a real GET /api/cards fetch.
vi.mock('./hooks/useCards.js', () => ({
  useCards: () => ({
    cards: [],
    createCard: vi.fn(),
    createSubcard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    uploadCardImage: vi.fn(),
    deleteCardImage: vi.fn(),
    previewClearFinished: vi.fn(),
    clearFinished: vi.fn(),
  }),
}));

vi.mock('./components/Sidebar.jsx', () => ({
  Sidebar: () => <div data-testid="mock-sidebar">Sidebar (MainLayout marker)</div>,
}));

vi.mock('./components/TasksDrawer.jsx', () => ({
  // Rendered unconditionally by MainLayout regardless of selectedProjectId —
  // stub it out so it doesn't need real drawer state/props to run.
  TasksDrawer: () => null,
}));

// jsdom (as configured in this project) does not implement window.matchMedia,
// which useSidebarCollapsed() (App.jsx) calls synchronously on first render.
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

// Import App AFTER the mocks above are registered (vi.mock is hoisted, but
// keeping the dynamic import style out isn't necessary here — a static
// top-level import works fine since vi.mock calls are hoisted above it).
import App from './App.jsx';

describe('App routing (Tarefa 17)', () => {
  // The header trigger's accessible name is built from the CURRENT system
  // (config/systems.js), not a fixed app name — at "/" that's the "escritorio"
  // system entry (nome: "Escritório"). The chevron ("▾") is always present on
  // the trigger regardless of route, so it's used as a route-independent
  // selector to open the dropdown below.
  const openSwitcher = () => fireEvent.click(screen.getByRole('button', { name: /▾/ }));

  it('renders MainLayout on the initial "/" path', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    // getBy* throws (failing the test) if the element isn't found — its
    // successful return is itself the assertion. No jest-dom is installed in
    // this project (no @testing-library/jest-dom dependency, no other test
    // file uses .toBeInTheDocument()), so we stick to plain vitest matchers.
    expect(screen.getByTestId('mock-sidebar')).toBeTruthy();
    expect(screen.queryByText('Board — em construção')).toBeNull();
    expect(screen.queryByText('Tarefas — em construção')).toBeNull();
  });

  it('always renders AppLauncherHeader regardless of route', () => {
    // useRoute() reads window.location.pathname only once, at mount, and
    // otherwise updates via its own navigate()/popstate handling — plain
    // history.pushState() (no popstate fired) won't move an already-mounted
    // App. So each route below gets its own fresh mount (full page-load
    // simulation), rather than reusing one render() + rerender().
    window.history.pushState({}, '', '/');
    const r1 = render(<App />);
    expect(screen.getByText('Escritório')).toBeTruthy(); // current system name
    r1.unmount();

    window.history.pushState({}, '', '/board');
    const r2 = render(<App />);
    expect(screen.getByText('Board', { selector: 'span' })).toBeTruthy();
    r2.unmount();

    window.history.pushState({}, '', '/tarefas');
    render(<App />);
    expect(screen.getByText('Tarefas', { selector: 'span' })).toBeTruthy();
  });

  it('navigating via AppLauncherHeader dropdown to /board swaps the content to BoardView', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    // Open the switcher dropdown and click the "Board" entry.
    openSwitcher();
    fireEvent.click(screen.getByRole('menuitem', { name: /Board/i }));

    // BoardView (Tarefa 26) is the real component now, not the "Board — em
    // construção" placeholder — with useCards mocked to an empty state (see
    // mock above) and api.fetchProjects resolving to [], it renders its
    // empty-state copy.
    expect(await screen.findByText('Nenhum card ainda.')).toBeTruthy();
    expect(screen.queryByTestId('mock-sidebar')).toBeNull();
    // Header stays mounted across the route change, now showing "Board" as
    // current — BoardView's own topbar title (Tarefa 26) also renders the
    // literal text "Board" now, so there are 2 matching spans (header +
    // topbar), not 1; assert at least one exists rather than a single exact
    // match.
    expect(screen.getAllByText('Board', { selector: 'span' }).length).toBeGreaterThan(0);
  });

  it('navigating to /tarefas swaps the content to TarefasGlobalView', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    openSwitcher();
    fireEvent.click(screen.getByRole('menuitem', { name: /Tarefas/i }));

    // TarefasGlobalView (Tarefa 28) is the real component now, not the
    // "Tarefas — em construção" placeholder — with useGlobalTasks mocked to
    // an empty/loaded state (see mock above) and api.fetchProjects resolving
    // to [], it renders its global-empty-state copy (05-DESIGNER.md 14.6).
    expect(await screen.findByText(/Nenhuma tarefa pendente em nenhum projeto\. Tudo em dia\./)).toBeTruthy();
    expect(screen.queryByTestId('mock-sidebar')).toBeNull();
  });
});
