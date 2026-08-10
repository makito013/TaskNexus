// frontend/src/layouts/v2/TaskQuickCreatePopover.test.jsx
// QA (Fase "Tarefas" no v2, Tarefa 7): cobre o popover de criação rápida de
// tarefa isoladamente — idle prende o submit sem título, estado salvando
// (botão desabilitado + "Criando…"), erro (alert + painel intacto, sem
// reset), sucesso (fecha + reseta os 3 campos), auto-fechamento ao trocar a
// sessão ativa, e o <select> de projeto com optgroup (clientes + subprojetos).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TaskQuickCreatePopover } from './TaskQuickCreatePopover.jsx';

afterEach(() => cleanup());

const PROJECTS = [
  { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [], sub_projetos: [] },
  {
    id: 'cliente_projeto_1',
    nome: 'Cliente 1',
    path: '/cliente_projeto_1',
    agentes: [],
    sub_projetos: ['cliente_projeto_1/subprojeto_1', 'cliente_projeto_1/gateways'],
  },
  { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
  { id: 'cliente_projeto_1/gateways', nome: 'Gateways', path: '/cliente_projeto_1/gateways', agentes: [], sub_projetos: [] },
];

/** Promise controlável, pra segurar o estado "salvando" aberto durante o teste. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPopover(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    sessionKey: 'cliente_projeto_1::claude',
    projects: PROJECTS,
    onCreateTask: vi.fn().mockResolvedValue({ id: 1 }),
    ...overrides,
  };
  const utils = render(<TaskQuickCreatePopover {...props} />);
  return { ...utils, props };
}

const titleInput = () => screen.getByPlaceholderText('Título da tarefa');
const submitBtn = () => screen.getByText(/^(Criar|Criando…)$/).closest('button');

describe('TaskQuickCreatePopover — open=false', () => {
  it('não renderiza nada quando fechado', () => {
    renderPopover({ open: false });
    expect(screen.queryByText('Nova tarefa')).toBeNull();
  });
});

describe('TaskQuickCreatePopover — estado idle', () => {
  it('submit começa desabilitado sem título', () => {
    renderPopover();
    expect(submitBtn().disabled).toBe(true);
  });

  it('submit habilita quando o título tem conteúdo (trim)', () => {
    renderPopover();
    fireEvent.change(titleInput(), { target: { value: '  ' } });
    expect(submitBtn().disabled).toBe(true); // só espaços = ainda vazio
    fireEvent.change(titleInput(), { target: { value: 'Minha tarefa' } });
    expect(submitBtn().disabled).toBe(false);
  });

  it('clicar em submit desabilitado (sem título) não chama onCreateTask', () => {
    const onCreateTask = vi.fn().mockResolvedValue({ id: 1 });
    renderPopover({ onCreateTask });
    fireEvent.click(submitBtn());
    expect(onCreateTask).not.toHaveBeenCalled();
  });
});

describe('TaskQuickCreatePopover — estado salvando', () => {
  it('durante o POST o botão fica desabilitado e mostra "Criando…"', async () => {
    const d = deferred();
    const onCreateTask = vi.fn().mockReturnValue(d.promise);
    renderPopover({ onCreateTask });

    fireEvent.change(titleInput(), { target: { value: 'Tarefa em voo' } });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(screen.getByText('Criando…')).toBeTruthy());
    expect(submitBtn().disabled).toBe(true);

    d.resolve({ id: 1 });
    await waitFor(() => expect(onCreateTask).toHaveBeenCalledTimes(1));
  });
});

describe('TaskQuickCreatePopover — erro', () => {
  it('falha dispara alert e mantém o painel aberto com o conteúdo intacto (sem reset, sem onClose)', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onCreateTask = vi.fn().mockRejectedValue(new Error('boom'));
    const { props } = renderPopover({ onCreateTask });

    fireEvent.change(titleInput(), { target: { value: 'Vai falhar' } });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Falha ao criar tarefa. Tente novamente.'));
    // Painel continua aberto e o conteúdo NÃO foi resetado.
    expect(screen.getByText('Nova tarefa')).toBeTruthy();
    expect(titleInput().value).toBe('Vai falhar');
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('cliente_projeto_1/subprojeto_1');
    expect(props.onClose).not.toHaveBeenCalled();
    // Submit volta a ficar clicável (saving=false), não trava em "Criando…".
    await waitFor(() => expect(submitBtn().disabled).toBe(false));

    alertSpy.mockRestore();
  });
});

describe('TaskQuickCreatePopover — sucesso', () => {
  it('cria a tarefa com a sessionKey + payload corretos, fecha e reseta os 3 campos', async () => {
    const onCreateTask = vi.fn().mockResolvedValue({ id: 42 });
    const { props } = renderPopover({ onCreateTask, sessionKey: 'cliente_projeto_1::claude' });

    fireEvent.change(titleInput(), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/gateways' } });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith('cliente_projeto_1::claude', {
      titulo: 'Nova',
      descricao_markdown: '',
      descricao_html: null,
      projeto_id: 'cliente_projeto_1/gateways',
    }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    // open continua true (o pai controla; aqui é vi.fn), então o painel segue
    // renderizado — dá pra observar os 3 campos zerados.
    expect(titleInput().value).toBe('');
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('');
  });

  it('sem projeto escolhido: projeto_id vai como null', async () => {
    const onCreateTask = vi.fn().mockResolvedValue({ id: 1 });
    renderPopover({ onCreateTask });
    fireEvent.change(titleInput(), { target: { value: 'Sem projeto' } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith('cliente_projeto_1::claude', expect.objectContaining({
      projeto_id: null,
    })));
  });
});

describe('TaskQuickCreatePopover — fechamento', () => {
  it('clicar no "×" fecha (onClose)', () => {
    const { props } = renderPopover();
    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('clicar no scrim (fora do painel) fecha', () => {
    const { props } = renderPopover();
    fireEvent.click(screen.getByTestId('task-popover-scrim'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('clicar DENTRO do painel não fecha (stopPropagation)', () => {
    const { props } = renderPopover();
    fireEvent.click(screen.getByTestId('task-popover-panel'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('ESC fecha', () => {
    const { props } = renderPopover();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('fecha sozinho (descarta rascunho) quando a sessionKey ativa muda enquanto aberto', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <TaskQuickCreatePopover
        open
        onClose={onClose}
        sessionKey="cliente_projeto_1::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
      />
    );
    // 1º render com a mesma key não dispara fechamento.
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <TaskQuickCreatePopover
        open
        onClose={onClose}
        sessionKey="podesubir::claude"
        projects={PROJECTS}
        onCreateTask={vi.fn()}
      />
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TaskQuickCreatePopover — select de projeto (optgroup)', () => {
  it('lista "Nenhum projeto", optgroup por cliente-com-subprojetos (raiz + subs) e opção solta para cliente sem subprojetos', () => {
    renderPopover();
    const select = screen.getByLabelText('Projeto (opcional)');

    // Primeira opção sempre "Nenhum projeto" com value ''.
    const firstOption = select.querySelector('option');
    expect(firstOption.value).toBe('');
    expect(firstOption.textContent).toBe('Nenhum projeto');

    // Cliente COM subprojetos -> optgroup com label = nome do cliente.
    const optgroups = Array.from(select.querySelectorAll('optgroup'));
    const clienteGroup = optgroups.find((g) => g.label === 'Cliente 1');
    expect(clienteGroup).toBeTruthy();
    const groupOptions = Array.from(clienteGroup.querySelectorAll('option')).map((o) => ({
      value: o.value,
      text: o.textContent,
    }));
    // Raiz do cliente + cada subprojeto, com nome RESOLVIDO (não id cru).
    expect(groupOptions).toEqual([
      { value: 'cliente_projeto_1', text: 'Cliente 1' },
      { value: 'cliente_projeto_1/subprojeto_1', text: 'Subprojeto 1' },
      { value: 'cliente_projeto_1/gateways', text: 'Gateways' },
    ]);

    // Cliente SEM subprojetos -> opção solta, fora de qualquer optgroup.
    const looseOption = Array.from(select.children).find(
      (child) => child.tagName === 'OPTION' && child.value === 'podesubir'
    );
    expect(looseOption).toBeTruthy();
    expect(looseOption.textContent).toBe('Pode Subir');
  });
});
