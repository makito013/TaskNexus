// frontend/src/layouts/v2/ConfiguracaoV2.test.jsx
// Tela "Configuração" do layout v2 (era AgentesV2.test.jsx): grid de agentes
// globais + CRUD completo (criar/editar/excluir) + o seletor de pasta de
// projetos no rodapé.
//
// `useAgentSettings` é mockado (a tela não deve falar com /api/agents
// direto); `api.fetchProjectsRoot` é mockado porque <ProjectsRootSetting />
// passou a ser montado aqui e faria um fetch real no mount.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfiguracaoV2 } from './ConfiguracaoV2.jsx';
import { api } from '../../services/api.js';

const mockUseAgentSettings = vi.fn();
vi.mock('../../hooks/useAgentSettings.js', () => ({
  useAgentSettings: () => mockUseAgentSettings(),
}));

const AGENT = { id: 'claude-work', nome: 'Claude (Work)', papel: 'Assistente', ia: 'claude', cmd: ['claude', '--settings', '~/.claude-work'] };

/** Estado padrão do hook, com os 3 mutadores presentes — sobrescrito por
 * teste via `hookState({ agents: [...] })`. */
function hookState(overrides = {}) {
  const state = {
    agents: [],
    loading: false,
    createAgent: vi.fn().mockResolvedValue({}),
    updateAgent: vi.fn().mockResolvedValue({}),
    deleteAgent: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  mockUseAgentSettings.mockReturnValue(state);
  return state;
}

function fillRequiredFields({ id = 'novo', nome = 'Novo Agente', papel = 'Assistente', cmd = 'claude' } = {}) {
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: nome } });
  fireEvent.change(screen.getByLabelText('Papel'), { target: { value: papel } });
  fireEvent.change(screen.getByLabelText('Comando'), { target: { value: cmd } });
}

/** O botão "Salvar" do AgentForm — distinto do "Salvar pasta" de
 * <ProjectsRootSetting />, que fica montado na mesma tela. */
const saveAgent = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

beforeEach(() => {
  // ProjectsRootSetting chama window.location.reload() no caminho feliz —
  // jsdom não implementa navegação de verdade, então trocamos por um spy
  // (mesmo padrão de ProjectsRootSetting.test.jsx).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
  vi.spyOn(api, 'fetchProjectsRoot').mockResolvedValue({
    projects_root_path: null,
    resolved_path: '/home/bruno/projetos',
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('ConfiguracaoV2 — grid de agentes globais', () => {
  it('shows a loading state', () => {
    hookState({ loading: true });
    render(<ConfiguracaoV2 />);
    expect(screen.getByText('Carregando...')).toBeTruthy();
  });

  it('shows an empty state pointing to the "+ Novo agente" button when there are no agents', () => {
    hookState();
    render(<ConfiguracaoV2 />);
    expect(screen.getByText(/Nenhum agente cadastrado ainda/)).toBeTruthy();
  });

  it('always renders the "+ Novo agente" button, even with agents already registered', () => {
    hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);
    expect(screen.getByRole('button', { name: '+ Novo agente' })).toBeTruthy();
  });

  it('renders one card per agent with nome/papel/ia/cmd and an "Ativo" toggle', () => {
    hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);

    const card = screen.getByTestId('agentes-v2-card-claude-work');
    expect(card.textContent).toContain('Claude (Work)');
    expect(card.textContent).toContain('Assistente');
    expect(card.textContent).toContain('claude --settings ~/.claude-work');
    expect(card.textContent).toContain('Ativo');
    expect(card.textContent).toContain('claude');
  });

  it('shows "Agentes cadastrados" as the section title, not the nav label "Configuração" repeated', () => {
    // Revisor: nav já usa "Configuração" pra tela inteira — repetir "Agentes"
    // sozinho aqui lia como duas telas empilhadas com nomes diferentes.
    hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);
    expect(screen.getByText('Agentes cadastrados')).toBeTruthy();
  });

  it('renders "ia" as a tag but does not duplicate "papel" as a second tag next to the description', () => {
    hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);

    // "Assistente" (papel) aparece só como descrição, não também como tag —
    // antes o mesmo valor virava os dois ao mesmo tempo no mesmo card.
    expect(screen.getAllByText('Assistente')).toHaveLength(1);
    expect(screen.getByText('claude')).toBeTruthy();
  });

  it('renders one card per agent when there are multiple', () => {
    hookState({
      agents: [
        { id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] },
        { id: 'gemini', nome: 'Gemini', papel: 'Assistente', ia: 'gemini', cmd: ['gemini'] },
      ],
    });
    render(<ConfiguracaoV2 />);
    expect(screen.getByTestId('agentes-v2-card-claude')).toBeTruthy();
    expect(screen.getByTestId('agentes-v2-card-gemini')).toBeTruthy();
  });
});

describe('ConfiguracaoV2 — criar agente', () => {
  it('opens the AgentForm when "+ Novo agente" is clicked and calls createAgent on submit', async () => {
    const { createAgent } = hookState();
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fillRequiredFields();
    saveAgent();

    await waitFor(() => expect(createAgent).toHaveBeenCalledWith({
      id: 'novo', nome: 'Novo Agente', papel: 'Assistente', ia: 'claude', cmd: ['claude'], env: {},
    }));
    // form closes and the "+ Novo agente" button reappears after saving
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Novo agente' })).toBeTruthy());
  });

  it('never calls updateAgent when creating', async () => {
    const { createAgent, updateAgent } = hookState();
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fillRequiredFields();
    saveAgent();

    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it('cancelling the form goes back to the list without calling createAgent', () => {
    const { createAgent } = hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByTestId('agentes-v2-card-claude-work')).toBeTruthy();
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe('ConfiguracaoV2 — editar agente', () => {
  it('opens a form pre-filled from the card and calls updateAgent(id, payload)', async () => {
    const { updateAgent, createAgent } = hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByLabelText('Editar Claude (Work)'));

    const idInput = screen.getByLabelText('ID');
    expect(idInput.value).toBe('claude-work');
    expect(idInput.disabled).toBe(true);
    expect(screen.getByLabelText('Nome').value).toBe('Claude (Work)');

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Claude Work 2' } });
    saveAgent();

    // updateAgent tem aridade 2 (id, payload) — createAgent tem 1. Passar o
    // mutador direto como onSubmit quebraria exatamente aqui.
    await waitFor(() => expect(updateAgent).toHaveBeenCalledWith('claude-work', {
      id: 'claude-work', nome: 'Claude Work 2', papel: 'Assistente', ia: 'claude',
      cmd: ['claude', '--settings', '~/.claude-work'], env: {},
    }));
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('mounts at most ONE form at a time, even with several agents listed', () => {
    hookState({
      agents: [
        { id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] },
        { id: 'gemini', nome: 'Gemini', papel: 'Assistente', ia: 'gemini', cmd: ['gemini'] },
      ],
    });
    render(<ConfiguracaoV2 />);

    // Sem formulário aberto, nenhum campo do AgentForm existe.
    expect(screen.queryByLabelText('ID')).toBeNull();

    fireEvent.click(screen.getByLabelText('Editar Claude'));

    // AgentForm usa ids de DOM FIXOS (agent-id, agent-nome, …): dois
    // formulários montados dariam getAllByLabelText('ID').length === 2 e
    // quebrariam a associação label/input. Um form aberto também substitui a
    // grid, então os cards saem de cena.
    expect(screen.getAllByLabelText('ID')).toHaveLength(1);
    expect(screen.queryByTestId('agentes-v2-card-gemini')).toBeNull();
  });
});

describe('ConfiguracaoV2 — excluir agente', () => {
  it('does not call deleteAgent when the confirmation is declined', () => {
    const { deleteAgent } = hookState({ agents: [AGENT] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByLabelText('Remover Claude (Work)'));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it('calls deleteAgent(id) when the confirmation is accepted', async () => {
    const { deleteAgent } = hookState({ agents: [AGENT] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByLabelText('Remover Claude (Work)'));

    await waitFor(() => expect(deleteAgent).toHaveBeenCalledWith('claude-work'));
  });

  // Revisor: handleDelete não tinha try/catch — uma rejeição (rede, 404
  // porque o agente já tinha sido removido em outra aba) virava unhandled
  // rejection silenciosa, sem NENHUM feedback pro usuário.
  it('shows an inline error, without crashing, when deleteAgent rejects', async () => {
    const deleteAgent = vi.fn().mockRejectedValue(new Error('Agente não encontrado.'));
    hookState({ agents: [AGENT], deleteAgent });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByLabelText('Remover Claude (Work)'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Agente não encontrado.'));
    // o card não sumiu silenciosamente — a lista continua íntegra, o erro
    // é só informativo, o Bruno decide se tenta de novo.
    expect(screen.getByTestId('agentes-v2-card-claude-work')).toBeTruthy();
  });

  // Achado do QA: o erro de uma exclusão anterior sobrevivia à troca de
  // formTarget e reaparecia colado numa operação de criar/editar/cancelar
  // sem NENHUMA relação com a exclusão que falhou.
  it('a stale delete error does not resurface after opening and closing an unrelated form', async () => {
    const deleteAgent = vi.fn().mockRejectedValue(new Error('Agente não encontrado.'));
    hookState({ agents: [AGENT], deleteAgent });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByLabelText('Remover Claude (Work)'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // abrir "+ Novo agente" e cancelar — nada a ver com a exclusão que falhou
    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// /api/agents e /api/projects são endpoints diferentes: useAgentSettings só
// recarrega o primeiro. Sem este aviso, um agente excluído aqui continuaria
// aparecendo como opção de "novo chat" (que lê /api/projects) até um reload.
describe('ConfiguracaoV2 — onAgentsChanged avisa o caller depois de cada mutação', () => {
  it('after creating', async () => {
    hookState();
    const onAgentsChanged = vi.fn().mockResolvedValue(undefined);
    render(<ConfiguracaoV2 onAgentsChanged={onAgentsChanged} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fillRequiredFields();
    saveAgent();

    await waitFor(() => expect(onAgentsChanged).toHaveBeenCalled());
  });

  it('after editing', async () => {
    hookState({ agents: [AGENT] });
    const onAgentsChanged = vi.fn().mockResolvedValue(undefined);
    render(<ConfiguracaoV2 onAgentsChanged={onAgentsChanged} />);

    fireEvent.click(screen.getByLabelText('Editar Claude (Work)'));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Claude Work 2' } });
    saveAgent();

    await waitFor(() => expect(onAgentsChanged).toHaveBeenCalled());
  });

  it('after deleting', async () => {
    hookState({ agents: [AGENT] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onAgentsChanged = vi.fn().mockResolvedValue(undefined);
    render(<ConfiguracaoV2 onAgentsChanged={onAgentsChanged} />);

    fireEvent.click(screen.getByLabelText('Remover Claude (Work)'));

    await waitFor(() => expect(onAgentsChanged).toHaveBeenCalled());
  });

  // Revisor: o agente já foi salvo com sucesso quando notifyChanged roda —
  // uma rejeição AQUI não pode reaparecer como "falha ao salvar agente" no
  // AgentForm, ou o Bruno leria um erro falso sobre uma operação que deu
  // certo.
  it('a rejected onAgentsChanged does not surface as a save error in AgentForm', async () => {
    const { createAgent } = hookState();
    const onAgentsChanged = vi.fn().mockRejectedValue(new Error('/api/projects indisponível'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ConfiguracaoV2 onAgentsChanged={onAgentsChanged} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fillRequiredFields();
    saveAgent();

    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    // form fecha normalmente — createAgent teve sucesso, é só o refresh que falhou
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Novo agente' })).toBeTruthy());
    expect(screen.queryByText(/[Ff]alha ao salvar/)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('is optional — mutations still work when the prop is absent', async () => {
    const { createAgent } = hookState();
    render(<ConfiguracaoV2 />);

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));
    fillRequiredFields();
    saveAgent();

    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    // sem onAgentsChanged o form ainda fecha (nenhum throw engolido no meio)
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Novo agente' })).toBeTruthy());
  });
});

describe('ConfiguracaoV2 — seletor de pasta de projetos', () => {
  it('renders <ProjectsRootSetting /> on the screen', async () => {
    hookState({ agents: [AGENT] });
    render(<ConfiguracaoV2 />);

    expect(screen.getByText('Pasta de projetos')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Procurar…' })).toBeTruthy();
    expect(screen.getByLabelText('Caminho da pasta de projetos')).toBeTruthy();
  });

  it('stays available while the agent form is open (it is not part of the form)', async () => {
    hookState();
    render(<ConfiguracaoV2 />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '+ Novo agente' }));

    expect(screen.getByText('Pasta de projetos')).toBeTruthy();
    // "Salvar" (agente) e "Salvar pasta" continuam sendo dois botões
    // distintos — nenhuma query ambígua entre os dois.
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar pasta' })).toBeTruthy();
  });

  it('saves a manually typed path through the same api.updateProjectsRoot used by the native picker', async () => {
    hookState();
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot').mockResolvedValue({
      projects_root_path: 'D:\\projetos', resolved_path: 'D:\\projetos',
    });
    render(<ConfiguracaoV2 />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Caminho da pasta de projetos'), { target: { value: 'D:\\projetos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('D:\\projetos'));
  });

  it('surfaces a backend rejection of a typed path in the same role="alert"', async () => {
    hookState();
    vi.spyOn(api, 'updateProjectsRoot').mockRejectedValue(new Error('Pasta não encontrada: D:\\nao-existe'));
    render(<ConfiguracaoV2 />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Caminho da pasta de projetos'), { target: { value: 'D:\\nao-existe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }));

    await waitFor(() => expect(
      within(screen.getByRole('alert')).getByText(/Pasta não encontrada/)
    ).toBeTruthy());
  });
});
