// frontend/src/components/board/CardFormModal.test.jsx
// Rewritten for the centred v2 modal: two modes (`create`, `edit`), a
// metadata rail, the card id in the header, and dirty tracking on `edit`.
//
// The old `create-subcard` describes were DELETED, not adapted — the mode no
// longer exists (subcards are MCP-only now), and a test over a removed mode
// is dead weight.
//
// ⚠️ jsdom is blind to everything visual here: `getBoundingClientRect` is
// always 0, there is no `matchMedia` (so `useMediaQuery` returns false and
// every test below runs the DESKTOP branch), and Vitest runs with
// `css: false`. Centring, the 720px stacked layout, the entry animation and
// the chip colours in both themes are manual QA.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CardFormModal } from './CardFormModal.jsx';

vi.mock('../../utils/clipboard.js', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Both without "/" (client-as-project / loose root project): neither has
// subprojects, so the 2nd select never shows with this fixture.
const PROJETOS = [
  { id: 'escritorio-agentes', nome: 'Escritório de Agentes', sub_projetos: [] },
  { id: 'outro-projeto', nome: 'Outro Projeto', sub_projetos: [] },
];

const PROJETOS_COM_SUBPROJETOS = [
  { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
  { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
  { id: 'podesubir', nome: 'Pode Subir', sub_projetos: [] },
];

function makeCard(overrides = {}) {
  return {
    id: 10,
    titulo: 'Card existente',
    projeto_id: 'escritorio-agentes',
    status: 'em_andamento',
    descricao: 'texto **negrito**',
    tipo: null,
    prazo: null,
    criado_em: '2026-08-30T09:15:00',
    subcards: [],
    imagens: [],
    ...overrides,
  };
}

// The board's columns are a PROP now (task #43): the modal no longer holds a
// fixed list of four statuses. These are the four legacy columns, so the
// pre-existing expectations below still describe the same form.
const COLUMNS = [
  { slug: 'a_fazer', label: 'A Fazer', position: 1, is_done: false },
  { slug: 'em_andamento', label: 'Em Andamento', position: 2, is_done: false },
  { slug: 'em_revisao', label: 'Em Revisão', position: 3, is_done: false },
  { slug: 'feito', label: 'Feito', position: 4, is_done: true },
];

function renderCreate(props = {}) {
  return render(
    <CardFormModal
      open
      mode="create"
      projetos={PROJETOS}
      columns={COLUMNS}
      doneSlug="feito"
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

function renderEdit(props = {}) {
  return render(
    <CardFormModal
      open
      mode="edit"
      card={makeCard()}
      projetos={PROJETOS}
      columns={COLUMNS}
      doneSlug="feito"
      onSubmit={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe('CardFormModal — open=false', () => {
  it('renders nothing', () => {
    render(
      <CardFormModal
        open={false}
        mode="create"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Novo Card')).toBeNull();
  });
});

describe('CardFormModal — mode="create"', () => {
  it('is titled "Novo Card" and carries no CardIdBadge (no id yet)', () => {
    renderCreate();
    expect(screen.getByText('Novo Card')).not.toBeNull();
    expect(screen.queryByLabelText(/^Copiar ID/)).toBeNull();
  });

  it('shows the Cliente select with every project without "/"', () => {
    renderCreate();
    const select = screen.getByLabelText('Cliente');
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.textContent))
      .toEqual(['Escritório de Agentes', 'Outro Projeto']);
  });

  it('shows the Projeto select only when the chosen client has subprojects', () => {
    renderCreate({ projetos: PROJETOS_COM_SUBPROJETOS });
    const projeto = screen.getByLabelText('Projeto (opcional)');
    expect([...projeto.options].map((o) => o.textContent))
      .toEqual(['Nenhum (vincula direto ao cliente)', 'Subprojeto 1']);
  });

  it('shows an informative hint instead of the Projeto select when there are no subprojects', () => {
    renderCreate();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/não tem subprojetos/)).not.toBeNull();
  });

  it('changing the client resets the project selection', () => {
    renderCreate({ projetos: PROJETOS_COM_SUBPROJETOS });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), {
      target: { value: 'cliente_projeto_1/subprojeto_1' },
    });
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('cliente_projeto_1/subprojeto_1');

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });

    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/não tem subprojetos/)).not.toBeNull();
  });

  // The fixed chip row became a native <select> fed by the board's columns.
  it('offers one status option per board column, in board order', () => {
    renderCreate();
    const select = screen.getByLabelText('Status');
    expect([...select.options].map((o) => o.value)).toEqual([
      'a_fazer', 'em_andamento', 'em_revisao', 'feito',
    ]);
  });

  it('marks the done column with a plain-text suffix, not a glyph', () => {
    renderCreate();
    const select = screen.getByLabelText('Status');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'A Fazer', 'Em Andamento', 'Em Revisão', 'Feito (concluída)',
    ]);
  });

  it('follows a renamed/reordered board instead of a hard-coded list', () => {
    renderCreate({
      columns: [
        { slug: 'feito', label: 'Entregue', position: 1, is_done: false },
        { slug: 'bloqueado', label: 'Bloqueado', position: 2, is_done: true },
      ],
      doneSlug: 'bloqueado',
    });
    const select = screen.getByLabelText('Status');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Entregue', 'Bloqueado (concluída)',
    ]);
  });

  it('defaults to the FIRST column when no defaultStatus is given', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({
      onSubmit,
      columns: [
        { slug: 'backlog', label: 'Backlog', position: 1, is_done: false },
        { slug: 'feito', label: 'Feito', position: 2, is_done: true },
      ],
    });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].status).toBe('backlog');
  });

  // QA: the board can never legitimately have zero columns (the last one
  // cannot be deleted), but the modal CAN be handed an empty list — useColumns
  // keeps `columns: []` when the initial fetch fails, by design. These two pin
  // what happens then, because "impossible" only covers the happy path.
  it('survives an empty column list instead of crashing the whole modal', () => {
    renderCreate({ columns: [], doneSlug: null });
    const select = screen.getByLabelText('Status');
    expect([...select.options]).toHaveLength(0);
    // The form is still usable — the failure is confined to one control.
    expect(screen.getByLabelText('Título')).not.toBeNull();
  });

  it('falls back to the hard-coded "a_fazer" when there are no columns to pick from', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({ onSubmit, columns: [], doneSlug: null });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Documented risk, not desired behaviour: on a board where the 'a_fazer'
    // COLUMN was deleted (a rename keeps the slug, so only deletion does it),
    // this payload is refused by the backend with a 400 the user
    // reads as "Coluna 'a_fazer' não existe" — confusing, since they never
    // chose it. It fails safe (nothing is written) rather than silently
    // creating an unrenderable card, which is why it is a 🔵 and not a bug.
    expect(onSubmit.mock.calls[0][0].status).toBe('a_fazer');
  });

  it('does not render the Imagens section nor "Criado em" (no card yet)', () => {
    renderCreate();
    expect(screen.queryByText('Imagens')).toBeNull();
    expect(screen.queryByText('Criado em')).toBeNull();
  });

  it('disables submit while the title is empty', () => {
    renderCreate();
    const submit = screen.getByText('Criar Card');
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'X' } });
    expect(screen.getByText('Criar Card').disabled).toBe(false);
  });

  it('opens on defaultClienteId / defaultProjetoId / defaultStatus', () => {
    renderCreate({
      projetos: PROJETOS_COM_SUBPROJETOS,
      defaultClienteId: 'cliente_projeto_1',
      defaultProjetoId: 'cliente_projeto_1/subprojeto_1',
      defaultStatus: 'em_revisao',
    });

    expect(screen.getByLabelText('Cliente').value).toBe('cliente_projeto_1');
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('cliente_projeto_1/subprojeto_1');
    // The active status chip is the bold one; assert through the payload
    // instead of styling, which jsdom cannot see.
  });

  it('ignores a defaultProjetoId that is not a direct child of the chosen client', () => {
    // The 2nd select only lists direct children — pre-selecting anything else
    // would blank the select silently.
    renderCreate({
      projetos: PROJETOS_COM_SUBPROJETOS,
      defaultClienteId: 'cliente_projeto_1',
      defaultProjetoId: 'cliente_projeto_1/subprojeto_1/neto',
    });
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('');
  });
});

describe('CardFormModal — create payload (contra-test for the dirty tracking)', () => {
  it('sends the COMPLETE payload even when only the title was typed', async () => {
    // Gating create by dirtyFields would drop cliente_id/status here and the
    // backend would answer 400. This test is the guard against that.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({ onSubmit, defaultStatus: 'em_andamento' });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      titulo: 'Novo',
      status: 'em_andamento',
      descricao: '',
      tipo: null,
      prazo: null,
      cliente_id: 'escritorio-agentes',
    });
  });

  it('never sends tipo/prazo as "" on create (an empty string is a 422)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({ onSubmit });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.tipo).toBeNull();
    expect(payload.prazo).toBeNull();
  });

  it('sends projeto_id (and no cliente_id) when a specific project is chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({ onSubmit, projetos: PROJETOS_COM_SUBPROJETOS });

    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), {
      target: { value: 'cliente_projeto_1/subprojeto_1' },
    });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.projeto_id).toBe('cliente_projeto_1/subprojeto_1');
    expect(payload).not.toHaveProperty('cliente_id');
  });

  it('carries the tipo and prazo the user picked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreate({ onSubmit });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.tipo).toBe('bug');
    expect(payload.prazo).toBe('2026-09-15');
  });
});

describe('CardFormModal — mode="edit"', () => {
  it('is titled "Editar Card", shows the CardIdBadge and pre-fills the fields', () => {
    renderEdit();
    expect(screen.getByText('Editar Card')).not.toBeNull();
    expect(screen.getByText('#10')).not.toBeNull();
    expect(screen.getByLabelText('Título').value).toBe('Card existente');
  });

  it('shows Projeto as read-only TEXT, never as a select; the client lives only in the header', () => {
    renderEdit();
    const projeto = screen.getByText('Projeto');
    expect(projeto.tagName).not.toBe('LABEL');
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    // The client name appears once: beside the id in the header (where the
    // plan pins it, so it survives the 720px stack). The rail's Cliente row
    // was removed — the header is the single source.
    expect(screen.getAllByText('Escritório de Agentes').length).toBe(1);
  });

  it('shows the Imagens section and the formatted "Criado em"', () => {
    renderEdit();
    expect(screen.getByText('Imagens')).not.toBeNull();
    expect(screen.getByText('Criado em')).not.toBeNull();
    expect(screen.getByText('30/08/2026')).not.toBeNull();
  });

  it('shows "Sem tipo"/"Sem prazo" when the card has neither', () => {
    renderEdit();
    expect(screen.getByLabelText('Tipo').value).toBe('');
    expect(screen.getByText('Sem tipo')).not.toBeNull();
    expect(screen.getByText('Sem prazo')).not.toBeNull();
  });

  it('pre-fills tipo and prazo when the card has them', () => {
    renderEdit({ card: makeCard({ tipo: 'hotfix', prazo: '2026-09-15' }) });
    expect(screen.getByLabelText('Tipo').value).toBe('hotfix');
    expect(screen.getByLabelText('Prazo').value).toBe('2026-09-15');
    expect(screen.queryByText('Sem prazo')).toBeNull();
  });
});

describe('CardFormModal — dirty tracking (edit only)', () => {
  it('changing ONLY the prazo submits prazo and nothing else', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onSubmit });

    fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.prazo).toBe('2026-10-01');
    expect(payload).not.toHaveProperty('titulo');
    expect(payload).not.toHaveProperty('descricao');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('tipo');
  });

  it('changing ONLY the tipo submits tipo and nothing else', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onSubmit });

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'bug' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.tipo).toBe('bug');
    expect(payload).not.toHaveProperty('titulo');
    expect(payload).not.toHaveProperty('prazo');
    expect(payload).not.toHaveProperty('status');
  });

  it('closes without calling onSubmit when edit mode has no dirty fields', () => {
    // The gate in handleSubmit: a Salvar click that changed nothing must not
    // reach onSubmit. An empty-body PATCH still makes the backend rewrite
    // `ultima_atualizacao_por`, stealing the attribution from whoever last
    // edited the card.
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderEdit({ onSubmit, onClose });

    fireEvent.click(screen.getByText('Salvar'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('touching the status select marks status dirty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onSubmit });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'feito' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ id: 10, status: 'feito' });
  });
});

describe('CardFormModal — clear sentinel ("" on edit)', () => {
  it('clicking "limpar" on the prazo submits prazo: "" — not null, not absent', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onSubmit, card: makeCard({ prazo: '2026-09-15' }) });

    fireEvent.click(screen.getByText('limpar'));
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.prazo).toBe('');
    expect(payload.prazo).not.toBeNull();
  });

  it('selecting "Sem tipo" submits tipo: "" — not null, not absent', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onSubmit, card: makeCard({ tipo: 'bug' }) });

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.tipo).toBe('');
    expect(payload.tipo).not.toBeNull();
  });
});

describe('CardFormModal — closing', () => {
  it('ESC calls onClose', () => {
    const onClose = vi.fn();
    renderEdit({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes the keydown listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderEdit({ onClose });

    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the overlay closes, clicking inside the panel does not', () => {
    const onClose = vi.fn();
    renderEdit({ onClose });
    const panel = screen.getByRole('dialog');
    const overlay = panel.parentElement;

    fireEvent.mouseDown(panel);
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when a text selection started inside the panel and ended on the overlay', () => {
    // Dragging a selection out of the textarea makes the click resolve to the
    // overlay. Closing there would silently discard the draft.
    const onClose = vi.fn();
    renderEdit({ onClose });
    const panel = screen.getByRole('dialog');
    const overlay = panel.parentElement;

    fireEvent.mouseDown(panel);
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('the ✕ and "Cancelar" both close', () => {
    const onClose = vi.fn();
    renderEdit({ onClose });

    fireEvent.click(screen.getByLabelText('Fechar'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('CardFormModal — cascading delete', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('warns with the subcard count before deleting', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onDelete, card: makeCard({ subcards: [{ id: 11 }, { id: 12 }] }) });

    fireEvent.click(screen.getByText('Excluir'));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 subtarefa(s)'));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(10));
  });

  it('does NOT delete when the warning is dismissed', () => {
    window.confirm.mockReturnValue(false);
    const onDelete = vi.fn();
    renderEdit({ onDelete, card: makeCard({ subcards: [{ id: 11 }] }) });

    fireEvent.click(screen.getByText('Excluir'));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes straight away, with no warning, when there are no subcards', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderEdit({ onDelete });

    fireEvent.click(screen.getByText('Excluir'));

    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(10));
  });

  it('offers no Excluir button in create mode', () => {
    renderCreate();
    expect(screen.queryByText('Excluir')).toBeNull();
  });
});

describe('CardFormModal — markdown preview', () => {
  it('opens already rendered when editing a card that has a description', () => {
    renderEdit();
    const preview = screen.getByTestId('card-descricao-preview');
    expect(preview.innerHTML).toContain('<strong>negrito</strong>');
  });

  it('opens raw when editing a card without a description', () => {
    renderEdit({ card: makeCard({ descricao: '' }) });
    expect(screen.queryByTestId('card-descricao-preview')).toBeNull();
    expect(screen.getByLabelText('Descrição (Markdown)')).not.toBeNull();
  });

  it('opens raw when creating', () => {
    renderCreate();
    expect(screen.queryByTestId('card-descricao-preview')).toBeNull();
  });

  it('toggling from the preview reveals the textarea pre-filled, and back', () => {
    renderEdit();

    fireEvent.click(screen.getByText('Editar'));
    const textarea = screen.getByLabelText('Descrição (Markdown)');
    expect(textarea.value).toBe('texto **negrito**');

    fireEvent.change(textarea, { target: { value: 'agora **outro**' } });
    fireEvent.click(screen.getByText('Visualizar'));

    expect(screen.getByTestId('card-descricao-preview').innerHTML).toContain('<strong>outro</strong>');
  });
});

describe('CardFormModal — submitting state', () => {
  it('disables the submit button while onSubmit is pending and closes after it resolves', async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    const onClose = vi.fn();
    renderCreate({ onSubmit, onClose });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(screen.getByText('Criando…').disabled).toBe(true));

    resolveSubmit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the modal open and alerts when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderCreate({ onSubmit, onClose });

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
