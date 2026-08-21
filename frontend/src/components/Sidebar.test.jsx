// frontend/src/components/Sidebar.test.jsx
// Regression guard for the "claude-work registered but no start-chat button
// appeared" bug: App.jsx's selectedProject (which feeds StartChatCTA/
// SessionTabs' "start new chat" buttons) and Sidebar's own project list used
// to be two independent, never-synced copies of /api/projects — Sidebar owned
// its own fetch instead of receiving `projects` from its parent. Registering
// a new global agent refreshed only Sidebar's private copy, so the sidebar
// badge could update while the "start chat" button (driven by App.jsx's
// separate, stale copy) never did. The fix: Sidebar takes `projects` as a
// prop (single source of truth, owned by App.jsx) instead of fetching its own.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Sidebar } from './Sidebar.jsx';
import { api } from '../services/api.js';

beforeEach(() => {
  // AppearanceSwitch (rodapé da sidebar) chama window.location.reload() no
  // caminho feliz — jsdom não implementa navegação de verdade.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const noop = () => {};

const baseProps = {
  onSelectProject: noop,
  selectedId: null,
  activeSessions: {},
  collapsed: false,
  onToggleCollapsed: noop,
  persistedSessions: {},
  activeSessionKey: null,
  onSelectChat: noop,
  onCloseChat: noop,
  onRenameChat: noop,
};

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

describe('Sidebar — projects come from a prop, not an internal fetch', () => {
  it('renders project badges from the projects prop', () => {
    vi.spyOn(api, 'fetchStatus').mockResolvedValue({ status: 'ok' });
    render(<Sidebar {...baseProps} projects={[projectWithClaudeWork]} />);

    expect(screen.getByText('Claude (Work)')).not.toBeNull();
  });

  it('never calls api.fetchProjects itself — the parent owns that fetch', async () => {
    vi.spyOn(api, 'fetchStatus').mockResolvedValue({ status: 'ok' });
    const fetchProjectsSpy = vi.spyOn(api, 'fetchProjects').mockResolvedValue([projectWithClaudeWork]);

    render(<Sidebar {...baseProps} projects={[projectWithClaudeWork]} />);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchProjectsSpy).not.toHaveBeenCalled();
  });
});

// Guarda de regressão do único caminho de saída do layout v1. O
// <AppearanceSwitch> morava no rodapé do modal de agentes
// (AgentSettingsModal.jsx); quando esse modal foi aposentado em favor da tela
// "Configuração" do v2, apagá-lo sem mais nada teria deixado um usuário em v1
// sem troca de layout e sem troca de tema — e sem nenhuma forma de ALCANÇAR o
// v2, onde as funcionalidades novas moram. Recuperação só via API/banco.
// Por isso o AppearanceSwitch subiu para o rodapé da própria sidebar.
describe('Sidebar — AppearanceSwitch acessível', () => {
  it('renders the theme switch in the sidebar footer', () => {
    vi.spyOn(api, 'fetchStatus').mockResolvedValue({ status: 'ok' });
    render(
      <Sidebar
        {...baseProps}
        projects={[projectWithClaudeWork]}
        initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }}
      />
    );

    expect(screen.getByText('Aparência')).not.toBeNull();
    const themeGroup = screen.getByRole('group', { name: 'Tema' });
    const darkButton = within(themeGroup).getByRole('button', { name: 'Escuro' });
    expect(darkButton.disabled).toBe(false);
    expect(within(themeGroup).getByRole('button', { name: 'Claro' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switching theme persists through api.updateAppearance', async () => {
    vi.spyOn(api, 'fetchStatus').mockResolvedValue({ status: 'ok' });
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockResolvedValue({});
    render(
      <Sidebar
        {...baseProps}
        projects={[projectWithClaudeWork]}
        initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }}
      />
    );

    fireEvent.click(within(screen.getByRole('group', { name: 'Tema' })).getByRole('button', { name: 'Escuro' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ theme_mode: 'dark', layout_version: 'v2' }));
  });

  it('no longer offers the old "Configurar agentes" entry point', () => {
    vi.spyOn(api, 'fetchStatus').mockResolvedValue({ status: 'ok' });
    render(<Sidebar {...baseProps} projects={[projectWithClaudeWork]} />);

    expect(screen.queryByLabelText('Configurar agentes')).toBeNull();
  });
});
