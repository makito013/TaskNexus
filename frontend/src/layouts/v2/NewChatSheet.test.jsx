// frontend/src/layouts/v2/NewChatSheet.test.jsx
// QA (feature Clientes na sidebar v2, Bloco C, rodada "Novo chat em modal", e
// agora a rodada da CASCATA de projeto de 2 níveis): cobre o formulário de
// "+ Novo chat" isoladamente — "Criar chat" preso em disabled até um agente
// ser escolhido E o alvo ser elegível, o select de nível 1 "Projeto principal"
// (`listPrimaryProjectsForClient`, agrupadoras incluídas), o slot de nível 2
// "Subprojeto" (`listSubProjectsForPrimary`, só monta o `<select>` quando há
// subprojeto), a tabela de empty states A–G, o botão de retry do caso A nos
// seus 3 desfechos, a região live, e o reset de seleção ao fechar
// (Cancelar/ESC/scrim — todos passam pelo mesmo `handleClose`).
//
// Modo "Todos": quando `cliente` vem null e `clientes` é passado no lugar,
// cobre o select extra de Cliente (primeiro campo), o campo Projeto principal
// disabled até escolher um cliente, e o reset encadeado da cascata.
//
// `presentation`: 'sheet' (default) roda dentro de BottomSheet — a maioria dos
// describes abaixo, sem passar a prop, cobre esse caso (regressão). Blocos
// dedicados cobrem 'modal' (dentro de CenteredModal), inclusive QUAL elemento
// recebe o foco inicial.
//
// NOTA DE CONVENÇÃO: as descrições de teste legadas deste arquivo estão em
// português; as adicionadas nesta rodada seguem o padrão do repo (inglês). A
// migração em massa das antigas está fora do escopo desta tarefa.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
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

// Client with NO children at all: level 1 has nothing to list, so it falls
// into state A (error line + retry button), not into a populated select.
const clienteSemSub = { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [] };
// Client with a single FLAT level of subprojects — every eligible project is a
// direct child, so they are all level-1 primaries with no level-2 options.
const clienteComSub = { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [] };
// Client with a real cascade: a grouping folder (`principal`) holding eligible
// projects at depth 1 and 2 below it, mirroring the shape Bruno described
// (podesubir/principal/{ymcy_backend, apps/podesubir-guardapp-rn}).
const clienteComCascata = { id: 'cascata', nome: 'Cascata', path: '/cascata', agentes: [] };
// Client whose own root is NOT eligible (no .claude/.gemini/.codex of its
// own) — synthesised by scan_projects as a `missing_parent`.
const clienteRaizNaoElegivel = { id: 'sem-raiz', nome: 'Sem Raiz', path: '/sem-raiz', agentes: [], elegivel: false };

// Flat `projects` array (as returned by /api/projetos) — includes the clients
// AND every descendant as separate entries with `elegivel`.
const PROJECTS = [
  { id: 'podesubir', nome: 'Pode Subir', elegivel: true },

  { id: 'cliente_projeto_1', nome: 'Cliente 1', elegivel: true },
  { id: 'cliente_projeto_1/subprojeto_1', nome: 'subprojeto_1', elegivel: true },
  { id: 'cliente_projeto_1/gateways', nome: 'gateways', elegivel: true },

  { id: 'cascata', nome: 'Cascata', elegivel: true },
  // Grouping primary WITH eligible descendants -> state D.
  { id: 'cascata/principal', nome: 'principal', elegivel: false },
  { id: 'cascata/principal/ymcy_backend', nome: 'ymcy_backend', elegivel: true },
  { id: 'cascata/principal/apps', nome: 'apps', elegivel: false },
  { id: 'cascata/principal/apps/podesubir-guardapp-rn', nome: 'podesubir-guardapp-rn', elegivel: true },
  // Eligible primary WITH eligible descendants -> populated select, option 1
  // "Todo o {primário}".
  { id: 'cascata/gateway', nome: 'gateway', elegivel: true },
  { id: 'cascata/gateway/access-gateway-controlid-db', nome: 'access-gateway-controlid-db', elegivel: true },
  // Eligible primary WITHOUT descendants -> state C.
  { id: 'cascata/portal_light', nome: 'portal_light', elegivel: true },
  // Grouping primary WITHOUT eligible descendants -> state E.
  { id: 'cascata/vazio', nome: 'vazio', elegivel: false },

  { id: 'sem-raiz', nome: 'Sem Raiz', elegivel: false },
  { id: 'sem-raiz/app', nome: 'app', elegivel: true },
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

describe('NewChatSheet — level 1 "Projeto principal"', () => {
  it('client with NO children at all: falls into state A (error line + retry button), no select', () => {
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto principal')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
    expect(screen.getByText('Carregar os projetos de novo')).not.toBeNull();
  });

  it('client WITH children: select with "Raiz de {name}" + 1 option per DIRECT child', () => {
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Projeto principal');
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toEqual(['Raiz de Cliente 1', 'gateways', 'subprojeto_1']);
  });

  it('lists non-eligible grouping folders as level-1 options (they are a navigation step)', () => {
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const optionTexts = Array.from(screen.getByLabelText('Projeto principal').querySelectorAll('option'))
      .map((o) => o.textContent);
    expect(optionTexts).toContain('principal');
    expect(optionTexts).toContain('vazio');
  });

  it('does NOT list a descendant deeper than a direct child at level 1', () => {
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const optionTexts = Array.from(screen.getByLabelText('Projeto principal').querySelectorAll('option'))
      .map((o) => o.textContent);
    expect(optionTexts).not.toContain('ymcy_backend');
    expect(optionTexts).not.toContain('apps / podesubir-guardapp-rn');
  });
});

describe('NewChatSheet — level 2 "Subprojeto" (cascade slot)', () => {
  const renderCascade = (props = {}) => render(
    <NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} {...props} />
  );

  it('state B: level 1 on "Raiz de {cliente}" shows a hint, never a <select>', () => {
    renderCascade();
    expect(screen.queryByLabelText('Subprojeto')).toBeNull();
    expect(screen.getByText('Subprojeto')).not.toBeNull();
    expect(screen.getByText('O chat abre na raiz de Cascata.')).not.toBeNull();
  });

  it('state D: a grouping primary mounts the <select> with "Selecione um subprojeto" + the M2 hint', () => {
    renderCascade();
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    const select = screen.getByLabelText('Subprojeto');
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toEqual(['Selecione um subprojeto', 'apps / podesubir-guardapp-rn', 'ymcy_backend']);
    const hint = screen.getByText('Escolha um subprojeto para criar o chat.');
    expect(hint.id).toBe('newchat-subproject-hint');
    expect(select.getAttribute('aria-describedby')).toBe('newchat-subproject-hint');
  });

  it('state D: the M2 hint (and its aria-describedby) drops once a real subproject is picked', () => {
    renderCascade();
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    fireEvent.change(screen.getByLabelText('Subprojeto'), { target: { value: 'cascata/principal/ymcy_backend' } });

    // The instruction would otherwise keep asking for an action already taken,
    // while "Criar chat" is enabled.
    expect(screen.queryByText('Escolha um subprojeto para criar o chat.')).toBeNull();
    expect(screen.getByLabelText('Subprojeto').getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById('newchat-subproject-hint')).toBeNull();
  });

  it('eligible primary WITH subprojects: option 1 is "Todo o {primário}" and there is no M2 hint', () => {
    renderCascade();
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/gateway' } });
    const select = screen.getByLabelText('Subprojeto');
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toEqual(['Todo o gateway', 'access-gateway-controlid-db']);
    expect(screen.queryByText('Escolha um subprojeto para criar o chat.')).toBeNull();
    expect(select.getAttribute('aria-describedby')).toBeNull();
  });

  it('state C: eligible primary with no subprojects shows a hint, no <select>', () => {
    renderCascade();
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/portal_light' } });
    expect(screen.queryByLabelText('Subprojeto')).toBeNull();
    // `selector` scopes to the VISIBLE hint: the live region carries the very
    // same sentence for this state, so an unscoped query matches twice.
    expect(screen.getByText('portal_light não tem subprojetos. O chat abre nele.', { selector: 'span' })).not.toBeNull();
  });

  it('state E: grouping primary with no eligible descendant shows the escape hint and locks submit', () => {
    renderCascade();
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/vazio' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.queryByLabelText('Subprojeto')).toBeNull();
    expect(screen.getByText('Nenhum subprojeto disponível agora. Escolha outro projeto principal.', { selector: 'span' })).not.toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('state G: the whole level-2 field is removed from the DOM when level 1 is in state A', () => {
    render(<NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByText('Subprojeto')).toBeNull();
  });

  it('state F: Todos mode before a client is picked shows the neutral hint', () => {
    render(<NewChatSheet open cliente={null} clientes={[clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('O subprojeto aparece quando você escolher o cliente e o projeto principal.')).not.toBeNull();
  });

  it('only filters by eligibility at level 2 — a non-eligible intermediate folder is not an option', () => {
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    const optionTexts = Array.from(screen.getByLabelText('Subprojeto').querySelectorAll('option'))
      .map((o) => o.textContent);
    expect(optionTexts).not.toContain('apps');
  });

  it('the legend is a <label htmlFor> only when the <select> exists, a <span> otherwise (M3)', () => {
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Subprojeto').tagName).toBe('SPAN');

    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    const legend = screen.getByText('Subprojeto');
    expect(legend.tagName).toBe('LABEL');
    expect(legend.getAttribute('for')).toBe('newchat-subproject-select');
    // The label IS the accessible name — no redundant aria-label on the select.
    expect(screen.getByLabelText('Subprojeto').getAttribute('aria-label')).toBeNull();
  });

  it('the level-2 slot keeps a stable outer node and a keyed inner node (motion replays)', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const animated = container.querySelectorAll('.v2-cascade-field-enter');
    expect(animated.length).toBe(1);
    // The animated node is the INNER one: its parent holds the min-height
    // floor and is not the animated element itself.
    expect(animated[0].parentElement.className).not.toContain('v2-cascade-field-enter');
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

  it('with primary project chosen: onSubmit(primaryId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('submits the DEEP subproject id when one is chosen at level 2', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    fireEvent.change(screen.getByLabelText('Subprojeto'), { target: { value: 'cascata/principal/apps/podesubir-guardapp-rn' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cascata/principal/apps/podesubir-guardapp-rn', 'claude');
  });

  it('a grouping primary is never a submit target — "Criar chat" stays locked until a real subproject', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Subprojeto'), { target: { value: 'cascata/principal/ymcy_backend' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);
  });

  it('"Todo o {primário}" keeps the primary as the target when it is eligible', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/gateway' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cascata/gateway', 'claude');
  });

  it('a client whose own root is NOT eligible cannot submit at the root (ADR-3)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteRaizNaoElegivel} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
    expect(screen.getByText('O chat não pode começar na raiz de Sem Raiz. Escolha um projeto principal.')).not.toBeNull();

    // Going down the cascade unlocks it — the data invariant guarantees the
    // path exists.
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'sem-raiz/app' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('sem-raiz/app', 'claude');
  });

  it('client with no eligible subproject: submit stays valid, uses activeClient.id', () => {
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

describe('NewChatSheet — chained cascade reset', () => {
  it('changing the primary clears a subproject picked under the previous one', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    fireEvent.change(screen.getByLabelText('Subprojeto'), { target: { value: 'cascata/principal/ymcy_backend' } });

    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/gateway' } });
    expect(screen.getByLabelText('Subprojeto').value).toBe('');

    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cascata/gateway', 'claude');
  });

  it('changing the client clears BOTH cascade levels', () => {
    const clientes = [clienteComCascata, clienteComSub];
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cascata' } });
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cascata/principal' } });
    fireEvent.change(screen.getByLabelText('Subprojeto'), { target: { value: 'cascata/principal/ymcy_backend' } });

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByLabelText('Projeto principal').value).toBe('');
    expect(screen.queryByLabelText('Subprojeto')).toBeNull();
  });
});

describe('NewChatSheet — modo "Todos" (sem cliente fixo, select de Cliente)', () => {
  const clientes = [clienteSemSub, clienteComSub];

  it('cliente=null, clientes=[...]: shows the Cliente select as the first field, generic title, Projeto principal field disabled', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Novo chat')).not.toBeNull();
    expect(screen.getByLabelText('Cliente')).not.toBeNull();
    expect(screen.getByLabelText('Projeto principal').disabled).toBe(true);
    expect(screen.getByText('Escolha um cliente para ver os projetos')).not.toBeNull();
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
  });

  it('picking a client with NO children: title updates and level 1 falls into state A with a retry button', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    expect(screen.getByText('Novo chat em Pode Subir')).not.toBeNull();
    expect(screen.queryByLabelText('Projeto principal')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
    expect(screen.getByText('Carregar os projetos de novo')).not.toBeNull();
  });

  it('picking a client WITH children: title updates and the level-1 select appears filtered by that client', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByText('Novo chat em Cliente 1')).not.toBeNull();
    const select = screen.getByLabelText('Projeto principal');
    expect(select.disabled).toBe(false);
    expect(screen.getByText('Raiz de Cliente 1')).not.toBeNull();
  });

  it('submit with no project: onSubmit(clienteEscolhido.id, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1', 'gemini');
  });

  it('submit with primary project chosen: onSubmit(primaryId, agentId)', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText('Criar chat'));
    expect(onSubmit).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1', 'claude');
  });

  it('changing the chosen client resets the previously selected project', () => {
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByLabelText('Projeto principal').value).toBe('');
  });

  it('clicar em "Criar chat" sem escolher cliente não chama onSubmit, mesmo com agente escolhido', () => {
    const onSubmit = vi.fn();
    render(<NewChatSheet open cliente={null} clientes={clientes} projects={PROJECTS} onClose={vi.fn()} onSubmit={onSubmit} />);
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

// The live region is the ONLY thing a screen-reader user has to follow the
// cascade: focus deliberately never moves to the field that appears. These
// tests assert the exact curated strings, because an aria-atomic region is
// re-read whole on every change and a generic string would be useless.
describe('NewChatSheet — cascade live region', () => {
  const getLiveRegion = (container) => container.querySelector('[aria-live="polite"]');

  it('is mounted from the first paint but says nothing (no announcement on mount)', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const region = getLiveRegion(container);
    expect(region).not.toBeNull();
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.className).toBe('v2-sr-only');
    expect(region.textContent).toBe('');
  });

  it('stays silent on mount even when level 1 opens straight into state A', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(getLiveRegion(container).textContent).toBe('');
  });

  it('L1-b: picking a client announces the level-1 count (plural)', () => {
    const { container } = render(
      <NewChatSheet open cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(getLiveRegion(container).textContent)
      .toBe('2 projetos principais para Cliente 1. Escolha um projeto principal.');
  });

  it('L1-c: picking a client whose level 1 comes back empty announces the failure and names the button', () => {
    const { container } = render(
      <NewChatSheet open cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    expect(getLiveRegion(container).textContent)
      .toBe('Não foi possível carregar os projetos de Pode Subir agora. Use o botão Carregar os projetos de novo.');
  });

  it('L2-d / L2-b / L2-c / L2-e: each level-1 choice announces its own state', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const primary = screen.getByLabelText('Projeto principal');

    fireEvent.change(primary, { target: { value: 'cascata/principal' } });
    expect(getLiveRegion(container).textContent)
      .toBe('Campo Subprojeto disponível, 2 opções. Escolha um subprojeto para criar o chat.');

    fireEvent.change(primary, { target: { value: 'cascata/gateway' } });
    expect(getLiveRegion(container).textContent)
      .toBe('Campo Subprojeto disponível, 1 opção. Padrão: Todo o gateway.');

    fireEvent.change(primary, { target: { value: 'cascata/portal_light' } });
    expect(getLiveRegion(container).textContent)
      .toBe('portal_light não tem subprojetos. O chat abre nele.');

    fireEvent.change(primary, { target: { value: 'cascata/vazio' } });
    expect(getLiveRegion(container).textContent)
      .toBe('Nenhum subprojeto disponível agora. Escolha outro projeto principal.');
  });

  it('L2-a: going back to "Raiz de {cliente}" announces where the chat lands', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const primary = screen.getByLabelText('Projeto principal');
    fireEvent.change(primary, { target: { value: 'cascata/gateway' } });
    fireEvent.change(primary, { target: { value: '' } });
    expect(getLiveRegion(container).textContent).toBe('O chat vai abrir na raiz de Cascata.');
  });

  it('L2-a: a non-eligible client root announces that it cannot take the chat', () => {
    const { container } = render(
      <NewChatSheet open cliente={clienteRaizNaoElegivel} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const primary = screen.getByLabelText('Projeto principal');
    fireEvent.change(primary, { target: { value: 'sem-raiz/app' } });
    fireEvent.change(primary, { target: { value: '' } });
    expect(getLiveRegion(container).textContent)
      .toBe('A raiz de Sem Raiz não recebe chat. Escolha um projeto principal.');
  });
});

// The retry affordance for state A. `refreshProjects` swallows its own errors,
// so success/failure are inferred POSITIONALLY from whether `primaries` filled
// up after the promise resolved — there is no error channel to observe.
describe('NewChatSheet — state A retry button', () => {
  const baseProps = {
    open: true,
    presentation: 'modal',
    cliente: clienteSemSub,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };
  const projectsAfterSuccess = [
    ...PROJECTS,
    { id: 'podesubir/principal', nome: 'principal', elegivel: true },
  ];

  it('calls onRetryProjects and shows the busy label without using the `disabled` attribute', async () => {
    let resolveRetry;
    const onRetryProjects = vi.fn(() => new Promise((resolve) => { resolveRetry = resolve; }));
    render(<NewChatSheet {...baseProps} projects={PROJECTS} onRetryProjects={onRetryProjects} />);

    fireEvent.click(screen.getByText('Carregar os projetos de novo'));
    expect(onRetryProjects).toHaveBeenCalledTimes(1);

    const busyButton = screen.getByText('Carregando os projetos…').closest('button');
    // `disabled` would drop focus to <body> in Chrome/Safari and break the
    // failure outcome — aria-busy + aria-disabled + an onClick guard instead.
    expect(busyButton.hasAttribute('disabled')).toBe(false);
    expect(busyButton.getAttribute('aria-busy')).toBe('true');
    expect(busyButton.getAttribute('aria-disabled')).toBe('true');

    // Clicking again while busy is a no-op (the onClick guard).
    fireEvent.click(busyButton);
    expect(onRetryProjects).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRetry(); });
  });

  it('success: focus moves to the level-1 select and L1-d is announced', async () => {
    const onRetryProjects = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <NewChatSheet {...baseProps} projects={PROJECTS} onRetryProjects={onRetryProjects} />
    );

    fireEvent.click(screen.getByText('Carregar os projetos de novo'));
    // The refreshed list lands BEFORE the promise continuation runs — no
    // `await` between these two statements, so no microtask can slip in.
    rerender(<NewChatSheet {...baseProps} projects={projectsAfterSuccess} onRetryProjects={onRetryProjects} />);
    await act(async () => {});

    const primary = screen.getByLabelText('Projeto principal');
    expect(document.activeElement).toBe(primary);
    expect(screen.queryByText('Carregar os projetos de novo')).toBeNull();
    // CenteredModal is portaled to document.body, so RTL's `container` does
    // not contain it.
    expect(document.querySelector('[aria-live="polite"]').textContent)
      .toBe('Projeto carregado. Foco no campo Projeto principal.');
  });

  it('failure: focus stays on the button and L1-e is announced', async () => {
    const onRetryProjects = vi.fn().mockResolvedValue(undefined);
    render(<NewChatSheet {...baseProps} projects={PROJECTS} onRetryProjects={onRetryProjects} />);

    fireEvent.click(screen.getByText('Carregar os projetos de novo'));
    await act(async () => {});

    const retryButton = screen.getByText('Carregar os projetos de novo').closest('button');
    expect(document.activeElement).toBe(retryButton);
    expect(document.querySelector('[aria-live="polite"]').textContent)
      .toBe('Ainda não foi possível carregar os projetos agora. Ou comece o chat na raiz de Pode Subir.');
  });

  it('failure on a non-eligible client root drops the "start at the root" escape route', async () => {
    const projectsSemRaiz = PROJECTS.filter((p) => p.id !== 'sem-raiz/app');
    const onRetryProjects = vi.fn().mockResolvedValue(undefined);
    render(<NewChatSheet {...baseProps} cliente={clienteRaizNaoElegivel} projects={projectsSemRaiz} onRetryProjects={onRetryProjects} />);

    fireEvent.click(screen.getByText('Carregar os projetos de novo'));
    await act(async () => {});

    expect(document.querySelector('[aria-live="polite"]').textContent)
      .toBe('Ainda não foi possível carregar os projetos agora.');
  });

  it('recovers (and does not stay stuck busy) when onRetryProjects rejects', async () => {
    const onRetryProjects = vi.fn().mockRejectedValue(new Error('network down'));
    render(<NewChatSheet {...baseProps} projects={PROJECTS} onRetryProjects={onRetryProjects} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Carregar os projetos de novo'));
    });

    expect(screen.getByText('Carregar os projetos de novo')).not.toBeNull();
    expect(screen.queryByText('Carregando os projetos…')).toBeNull();
  });

  it('the error line describes the button (aria-describedby), and the ids are the agreed ones', () => {
    render(<NewChatSheet {...baseProps} projects={PROJECTS} onRetryProjects={vi.fn()} />);
    const button = screen.getByText('Carregar os projetos de novo').closest('button');
    expect(button.getAttribute('aria-describedby')).toBe('newchat-primary-error');
    expect(document.getElementById('newchat-primary-error').textContent)
      .toBe('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.');
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
    const { container } = render(<NewChatSheet open cliente={clienteComSub} projects={PROJECTS} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Projeto principal'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.change(screen.getByLabelText('IA / Agente'), { target: { value: 'claude' } });
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });

    // O componente-pai é quem decide desmontar/fechar via `onClose`; aqui
    // testamos isoladamente que o estado interno do formulário já volta ao
    // zero no mesmo instante (select "" de novo, botão desabilitado de novo,
    // região live limpa), sem esperar um novo `open`.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Projeto principal').value).toBe('');
    expect(screen.getByText('Criar chat').closest('button').disabled).toBe(true);
    expect(container.querySelector('[aria-live="polite"]').textContent).toBe('');
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
    expect(screen.getByRole('dialog', { name: 'Novo chat em Cliente 1' })).not.toBeNull();
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

  it('Projeto principal field disabled in "Todos" mode before picking a client', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Projeto principal').disabled).toBe(true);
    expect(screen.getByText('Escolha um cliente para ver os projetos')).not.toBeNull();
  });

  it('state A when the active client has no children at all', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto principal')).toBeNull();
    expect(screen.getByText('Nenhum projeto disponível agora. O chat abre na raiz de Pode Subir.')).not.toBeNull();
  });
});

// QA (achado da revisão): a cadeia de `initialFocusRef` tem 3 vias
// (`primaryFieldPreChoice ? cliente : errorInPrimarySlot ? retry : primary`).
// Sem asserção de `document.activeElement`, um bug que trocasse as branches
// (ou quebrasse a população das callback refs) passaria silenciosamente:
// CenteredModal cai no fallback (foco no painel) sempre que a ref resolvida
// está null, o que é indistinguível de "funcionou" no relatório de testes.
describe('NewChatSheet — presentation="modal": which element receives initial focus', () => {
  it('"Todos" mode before picking a client: initial focus on the Cliente select', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Cliente'));
  });

  it('fixed client WITH children: initial focus on the Projeto principal select', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Projeto principal'));
  });

  // Inverted on purpose vs the previous round: there is now a real affordance
  // in state A, so focus goes to the retry button instead of falling back to
  // the panel.
  it('fixed client with NO children at all (state A): initial focus on the retry button, not the panel', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} onRetryProjects={vi.fn()} />);
    expect(screen.queryByLabelText('Projeto principal')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Carregar os projetos de novo').closest('button'));
  });

  // The bug this round was built to fix: `initialFocusRef` used to be one of
  // TWO ref objects, and the identity swap re-fired CenteredModal's focus
  // effect MID-SESSION, yanking focus on a Cliente change in Todos mode. The
  // primitive's own regression test cannot see this — NewChatSheet now uses a
  // single stable ref rewritten by three callback refs on every commit, which
  // is a different mechanism. These two cover it end to end.
  it('"Todos" mode: changing the Cliente does not steal focus from the Cliente select', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const clientSelect = screen.getByLabelText('Cliente');
    expect(document.activeElement).toBe(clientSelect);

    fireEvent.change(clientSelect, { target: { value: 'cliente_projeto_1' } });

    expect(screen.getByLabelText('Projeto principal')).not.toBeNull();
    expect(document.activeElement).toBe(clientSelect);
  });

  it('"Todos" mode: falling into state A at runtime announces it, but does NOT move focus to the retry button', () => {
    render(<NewChatSheet open presentation="modal" cliente={null} clientes={[clienteSemSub, clienteComSub]} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} onRetryProjects={vi.fn()} />);
    const clientSelect = screen.getByLabelText('Cliente');

    // `podesubir` has no children -> state A, so setRetryButtonRef re-points
    // initialFocusRef.current at the retry button. Focus must NOT follow it:
    // the user is still operating the Cliente select.
    fireEvent.change(clientSelect, { target: { value: 'podesubir' } });

    expect(screen.getByText('Carregar os projetos de novo')).not.toBeNull();
    expect(document.activeElement).toBe(clientSelect);
  });

  it('reopening the modal in a different state focuses the new target (the callback refs repopulate)', () => {
    const { rerender } = render(
      <NewChatSheet open={false} presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    rerender(<NewChatSheet open presentation="modal" cliente={clienteComSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Projeto principal'));

    rerender(<NewChatSheet open={false} presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    rerender(<NewChatSheet open presentation="modal" cliente={clienteSemSub} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} onRetryProjects={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByText('Carregar os projetos de novo').closest('button'));
  });

  it('does not steal focus when the level-2 field appears', () => {
    render(<NewChatSheet open presentation="modal" cliente={clienteComCascata} projects={PROJECTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const primary = screen.getByLabelText('Projeto principal');
    expect(document.activeElement).toBe(primary);

    fireEvent.change(primary, { target: { value: 'cascata/principal' } });

    expect(screen.getByLabelText('Subprojeto')).not.toBeNull();
    expect(document.activeElement).toBe(primary);
  });
});
