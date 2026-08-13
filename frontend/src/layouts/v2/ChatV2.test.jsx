// frontend/src/layouts/v2/ChatV2.test.jsx
// QA (Fase "Tarefas" no v2, Tarefa 8): cobre o header do ChatV2 — o botão
// "+ Tarefa" só nasce quando há sessão ativa, e ao clicar abre o
// TaskQuickCreatePopover recebendo a sessionKey/projects corretos e o
// onCreateTask repassado. TerminalPanel (xterm.js real) é mockado, mesmo
// padrão de AppV2.test.jsx.

import { createRef, forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ChatV2 } from './ChatV2.jsx';

// forwardRef (not a plain function component) so ChatV2's ref callback
// (`ref={(el) => { if (isActive) activePanelRef.current = el; }}`) has
// something real to attach to — exposes sessionKey via useImperativeHandle
// so the "activePanelRef points to the right session" test below can assert
// on identity without depending on any real TerminalPanel/xterm.js behavior.
vi.mock('../../components/TerminalPanel.jsx', () => ({
  TerminalPanel: forwardRef(function MockTerminalPanel({ sessionKey }, ref) {
    useImperativeHandle(ref, () => ({ sessionKey, forceFit: vi.fn(), sendControlByte: vi.fn() }), [sessionKey]);
    return <div data-testid="mock-terminal-panel">terminal</div>;
  }),
}));

// O hard gate do TerminalShortcutsFab (useIsTouchDevice) é irrelevante pro
// que este arquivo testa — força "touch" para que a presença/ausência do FAB
// (guiada por activeSession, não pelo tipo de dispositivo) seja o que
// está sob teste aqui.
vi.mock('../../hooks/useIsTouchDevice.js', () => ({
  useIsTouchDevice: () => true,
}));

afterEach(() => cleanup());

const PROJECTS = [
  {
    id: 'cliente_projeto_1',
    nome: 'Cliente 1',
    path: '/cliente_projeto_1',
    agentes: [{ id: 'claude', nome: 'Claude', papel: 'Assistente', ia: 'claude', cmd: ['claude'] }],
    sub_projetos: ['cliente_projeto_1/subprojeto_1'],
  },
  { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
];

const SESSION = { sessionKey: 'cliente_projeto_1::claude', projectId: 'cliente_projeto_1', agentId: 'claude' };

describe('ChatV2 — botão "+ Tarefa" no header', () => {
  it('NÃO renderiza o botão quando não há sessão ativa', () => {
    render(<ChatV2 sessions={[]} activeSessionKey={null} projects={PROJECTS} onCreateTask={vi.fn()} />);
    expect(screen.queryByText('+ Tarefa')).toBeNull();
  });

  it('renderiza o botão quando há sessão ativa', () => {
    render(
      <ChatV2
        sessions={[SESSION]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
      />
    );
    expect(screen.getByText('+ Tarefa')).toBeTruthy();
  });

  it('o popover começa fechado e abre ao clicar em "+ Tarefa"', () => {
    render(
      <ChatV2
        sessions={[SESSION]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
      />
    );
    expect(screen.queryByText('Nova tarefa')).toBeNull();
    fireEvent.click(screen.getByText('+ Tarefa'));
    expect(screen.getByText('Nova tarefa')).toBeTruthy();
  });

  it('cria a tarefa pela sessão ativa: onCreateTask recebe a sessionKey ativa', async () => {
    const onCreateTask = vi.fn().mockResolvedValue({ id: 1 });
    render(
      <ChatV2
        sessions={[SESSION]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={onCreateTask}
      />
    );
    fireEvent.click(screen.getByText('+ Tarefa'));
    fireEvent.change(screen.getByPlaceholderText('Título da tarefa'), { target: { value: 'Do chat' } });
    fireEvent.click(screen.getByText('Criar'));
    await vi.waitFor(() => expect(onCreateTask).toHaveBeenCalledWith('cliente_projeto_1::claude', expect.objectContaining({
      titulo: 'Do chat',
    })));
  });
});

// TL plano (Decisão 3): activePanelRef precisa apontar SEMPRE para o
// TerminalPanel da sessão ativa, mesmo depois de trocar de sessão — é o que
// o botão "Ajustar layout" (ResetLayoutButton, em AppV2.jsx) usa para saber
// em qual painel chamar forceFit().
describe('ChatV2 — activePanelRef aponta para o painel ativo', () => {
  const SESSION_A = { sessionKey: 'cliente_projeto_1::claude', projectId: 'cliente_projeto_1', agentId: 'claude' };
  const SESSION_B = { sessionKey: 'cliente_projeto_1::gemini', projectId: 'cliente_projeto_1', agentId: 'gemini' };

  it('activePanelRef.current corresponde à sessão ativa inicial', () => {
    const activePanelRef = createRef();
    render(
      <ChatV2
        sessions={[SESSION_A, SESSION_B]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
        activePanelRef={activePanelRef}
      />
    );

    expect(activePanelRef.current.sessionKey).toBe('cliente_projeto_1::claude');
  });

  it('activePanelRef.current passa a apontar pro novo painel após trocar de sessão ativa', () => {
    const activePanelRef = createRef();
    const { rerender } = render(
      <ChatV2
        sessions={[SESSION_A, SESSION_B]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
        activePanelRef={activePanelRef}
      />
    );
    expect(activePanelRef.current.sessionKey).toBe('cliente_projeto_1::claude');

    rerender(
      <ChatV2
        sessions={[SESSION_A, SESSION_B]}
        activeSessionKey="cliente_projeto_1::gemini"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
        activePanelRef={activePanelRef}
      />
    );

    expect(activePanelRef.current.sessionKey).toBe('cliente_projeto_1::gemini');
  });

  it('não quebra quando activePanelRef não é passado', () => {
    expect(() => {
      render(
        <ChatV2
          sessions={[SESSION_A]}
          activeSessionKey="cliente_projeto_1::claude"
          projects={PROJECTS}
          onCreateTask={vi.fn()}
        />
      );
    }).not.toThrow();
  });
});

// O painel de atalhos nasce SEMPRE fechado (decisão travada: o estado
// aberto/fechado não persiste) — então todo teste que procura um botão de
// atalho precisa antes abrir o painel pelo FAB. `openShortcutsPanel` é um tap:
// pointerDown + pointerUp sem movimento e abaixo do threshold de long-press,
// que é o único gesto que alterna o painel (ver a máquina de gestos em
// TerminalShortcutsFab.jsx).
function openShortcutsPanel() {
  const fab = screen.getByLabelText('Show terminal shortcuts');
  fireEvent.pointerDown(fab, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(fab, { clientX: 10, clientY: 10, pointerId: 1 });
}

describe('ChatV2 — TerminalShortcutsFab (atalhos touch)', () => {
  it('não renderiza quando não há sessão ativa', () => {
    render(<ChatV2 sessions={[]} activeSessionKey={null} projects={PROJECTS} onCreateTask={vi.fn()} />);
    expect(screen.queryByLabelText('Show terminal shortcuts')).toBeNull();
    expect(screen.queryByLabelText('Esc')).toBeNull();
  });

  it('renderiza os botões de atalho quando há sessão ativa e o painel é aberto pelo FAB', () => {
    render(
      <ChatV2
        sessions={[SESSION]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
      />
    );
    openShortcutsPanel();
    expect(screen.getByLabelText('Esc')).toBeTruthy();
    expect(screen.getByLabelText('Nova linha (Alt+Enter)')).toBeTruthy();
  });

  it('clicar em um botão de atalho chama sendControlByte no painel da sessão ativa', () => {
    const activePanelRef = createRef();
    render(
      <ChatV2
        sessions={[SESSION]}
        activeSessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
        activePanelRef={activePanelRef}
      />
    );
    openShortcutsPanel();

    const button = screen.getByLabelText('Esc');
    // TerminalShortcutsPanel só dispara no pointerup, depois de confirmar que o
    // ponteiro não se moveu (não foi um arrasto) — ver
    // TerminalShortcutsPanel.jsx.
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });

    expect(activePanelRef.current.sendControlByte).toHaveBeenCalledWith(new Uint8Array([0x1b]));
  });
});
