// frontend/src/App.test.jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./services/api.js', () => ({
  api: {
    fetchProjects: vi.fn().mockResolvedValue([]),
    fetchAgents: vi.fn().mockResolvedValue([]),
    fetchAppearance: vi.fn().mockResolvedValue({ layout_version: 'v2', theme_mode: 'light' }),
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

vi.mock('./hooks/useGlobalTasks.js', () => ({
  useGlobalTasks: () => ({
    tasks: [],
    loading: false,
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
  }),
}));

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

import App from './App.jsx';

describe('App routing', () => {
  it('renders AppV2 on the initial "/" path', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.queryByText('Board — em construção')).toBeNull();
    expect(screen.queryByText('Tarefas — em construção')).toBeNull();
  });

  it('renders AppLauncherHeader on a non-root route', () => {
    window.history.pushState({}, '', '/tarefas');
    render(<App />);
    expect(screen.getByText('Tarefas', { selector: 'span' })).toBeTruthy();
  });

  it('swaps content to TarefasGlobalView on /tarefas path', async () => {
    window.history.pushState({}, '', '/tarefas');
    render(<App />);
    expect(await screen.findByText(/Nenhuma tarefa pendente em nenhum projeto\. Tudo em dia\./)).toBeTruthy();
  });
});
