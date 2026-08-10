// frontend/src/components/board/CardFormModal.test.jsx
// Covers 05-DESIGNER.md seção 10 / 05-TL.md Tarefa 22: modal fullscreen de
// criar/editar card em 3 modos (create-top, create-subcard, edit).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CardFormModal } from './CardFormModal.jsx';

afterEach(() => cleanup());

// Ambos sem "/" (cliente-como-projeto/projeto-solto-na-raiz): nenhum tem
// subprojetos, então o 2º select (Tier 2) nunca aparece com esta fixture —
// os testes que precisam do Tier 2 usam PROJETOS_COM_SUBPROJETOS abaixo.
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
    subcards: [],
    imagens: [],
    ...overrides,
  };
}

describe('CardFormModal — open=false', () => {
  it('renders nothing', () => {
    render(
      <CardFormModal
        open={false}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Novo Card')).toBeNull();
  });
});

describe('CardFormModal — mode="create-top"', () => {
  it('shows the Cliente field (1º select) with all clientes without "/"', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Cliente')).not.toBeNull();
    expect(screen.getByText('Escritório de Agentes')).not.toBeNull();
  });

  it('cliente sem subprojetos: não mostra o 2º select (Projeto), mostra texto informativo', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
    expect(screen.getByText(/não tem subprojetos/)).not.toBeNull();
  });

  it('cliente com subprojetos: mostra o 2º select (Projeto opcional) com os subprojetos dele', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS_COM_SUBPROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    // Cliente default é o primeiro (Cliente 1), que tem subprojetos.
    expect(screen.getByLabelText('Projeto (opcional)')).not.toBeNull();
    expect(screen.getByText('Subprojeto 1')).not.toBeNull();
  });

  it('trocar de Cliente reseta a seleção de Projeto (2º select)', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS_COM_SUBPROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('cliente_projeto_1/subprojeto_1');

    // Troca pra um cliente sem subprojetos: o 2º select some (e a seleção
    // anterior não sobrevive escondida).
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'podesubir' } });
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();

    // Volta pro cliente com subprojetos: o 2º select reaparece resetado
    // (sem carregar "Subprojeto 1" da seleção anterior).
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente_projeto_1' } });
    expect(screen.getByLabelText('Projeto (opcional)').value).toBe('');
  });

  it('offers all 4 status chips', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('A Fazer')).not.toBeNull();
    expect(screen.getByText('Em Andamento')).not.toBeNull();
    expect(screen.getByText('Em Revisão')).not.toBeNull();
    expect(screen.getByText('Feito')).not.toBeNull();
  });

  it('does not render ImageAttachments (no card id yet)', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
  });

  it('submete cliente_id (card cliente-only) quando o cliente escolhido não tem projeto específico selecionado', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nova tarefa' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'outro-projeto' } });
    fireEvent.click(screen.getByText('Feito'));
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      titulo: 'Nova tarefa',
      status: 'feito',
      descricao: '',
      cliente_id: 'outro-projeto',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('submete projeto_id (sem cliente_id) quando um projeto específico foi escolhido no 2º select', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS_COM_SUBPROJETOS}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Card do subprojeto' } });
    fireEvent.change(screen.getByLabelText('Projeto (opcional)'), { target: { value: 'cliente_projeto_1/subprojeto_1' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.projeto_id).toBe('cliente_projeto_1/subprojeto_1');
    expect(payload.cliente_id).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('disables submit while titulo is empty', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Criar Card').disabled).toBe(true);
  });
});

describe('CardFormModal — mode="create-subcard"', () => {
  it('does NOT show the Projeto field (herdado do pai)', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-subcard"
        parentId={5}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Projeto')).toBeNull();
  });

  it('does NOT show the Cliente field either (feature Cliente/Projeto: herdado do pai)', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-subcard"
        parentId={5}
        projetos={PROJETOS_COM_SUBPROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();
  });

  it('offers all 4 status options — restriction to a_fazer/em_andamento is an MCP-only rule, not a UI rule', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-subcard"
        parentId={5}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('A Fazer')).not.toBeNull();
    expect(screen.getByText('Em Andamento')).not.toBeNull();
    expect(screen.getByText('Em Revisão')).not.toBeNull();
    expect(screen.getByText('Feito')).not.toBeNull();
  });

  it('submits payload with parent_id and without projeto_id', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    render(
      <CardFormModal
        open={true}
        mode="create-subcard"
        parentId={5}
        projetos={PROJETOS}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Subtarefa X' } });
    fireEvent.click(screen.getByText('Criar Subtarefa'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.parent_id).toBe(5);
    expect(payload.projeto_id).toBeUndefined();
    expect(payload.titulo).toBe('Subtarefa X');
  });
});

describe('CardFormModal — mode="edit"', () => {
  it('pre-fills fields from card and shows ImageAttachments', () => {
    const card = makeCard({ imagens: [{ id: 1, url: '/x.png' }] });
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Título').value).toBe('Card existente');
    expect(screen.getByTestId('image-thumb-1')).not.toBeNull();
    expect(screen.getByText('Excluir')).not.toBeNull();
  });

  it('does not show the Projeto field nor the Cliente field', () => {
    const card = makeCard();
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Projeto')).toBeNull();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
  });

  it('submit label reads "Salvar" and calls onSubmit with the card id', async () => {
    const card = makeCard();
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={onSubmit}
        onDelete={vi.fn()}
        onClose={onClose}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ id: 10, titulo: 'Card existente' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('CardFormModal — exclusão em cascata', () => {
  let confirmSpy;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm');
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('card COM subcards: shows a warning mentioning the count before calling onDelete', async () => {
    confirmSpy.mockReturnValue(true);
    const card = makeCard({ subcards: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const onDelete = vi.fn().mockResolvedValue();
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Excluir'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('3 subtarefa(s)');
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(10));
  });

  it('card COM subcards: cancelling the warning does NOT call onDelete', () => {
    confirmSpy.mockReturnValue(false);
    const card = makeCard({ subcards: [{ id: 1 }] });
    const onDelete = vi.fn();
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Excluir'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('card SEM subcards: calls onDelete directly, without mentioning subtarefas that do not exist', async () => {
    const card = makeCard({ subcards: [] });
    const onDelete = vi.fn().mockResolvedValue();
    render(
      <CardFormModal
        open={true}
        mode="edit"
        card={card}
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
        onUploadImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Excluir'));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(10));
  });
});

describe('CardFormModal — preview de markdown', () => {
  it('toggling "Visualizar" renders the markdown as HTML (e.g. **negrito** -> <strong>)', () => {
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Descrição (Markdown)'), {
      target: { value: 'texto **negrito** aqui' },
    });
    fireEvent.click(screen.getByText('Visualizar'));

    const preview = screen.getByTestId('card-descricao-preview');
    expect(preview.innerHTML).toContain('<strong>negrito</strong>');

    // Alterna de volta para edição.
    fireEvent.click(screen.getByText('Editar'));
    expect(screen.getByLabelText('Descrição (Markdown)').value).toBe('texto **negrito** aqui');
  });
});

describe('CardFormModal — estado de envio', () => {
  it('disables the submit button while onSubmit is pending and closes after it resolves', async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    const onClose = vi.fn();
    render(
      <CardFormModal
        open={true}
        mode="create-top"
        projetos={PROJETOS}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Card X' } });
    fireEvent.click(screen.getByText('Criar Card'));

    expect(screen.getByText('Criando…')).not.toBeNull();
    expect(screen.getByText('Criando…').disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    resolveSubmit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
