// frontend/src/components/board/CardItem.test.jsx
// Covers Tarefa 23 (05-TL.md) / 05-DESIGNER.md seções 3, 4, 6.1, 6.2, 9:
// CardItem nas variantes `row` (Lista) e `card` (Board), mesmo dado
// (`card`), contador de progresso condicional/colorido, expandir/recolher
// local, MoveCardMenu reaproveitado, título abre edição, "+ subtarefa" e
// ordem fixa do footer na variante cartão.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { CardItem } from './CardItem.jsx';

afterEach(() => cleanup());

function makeCard(overrides = {}) {
  return {
    id: 42,
    titulo: 'Corrigir cursor desalinhado no terminal em landscape',
    projeto_id: 'podesubir',
    parent_id: null,
    status: 'em_andamento',
    origem: 'bruno',
    ultima_atualizacao_por: 'bruno',
    descricao: null,
    criado_em: 1700000000,
    atualizado_em: Math.floor(Date.now() / 1000) - 7200, // ~2h atrás
    subcards: [],
    subcards_resumo: null,
    imagens: [],
    ...overrides,
  };
}

function noop() {}

function baseProps(overrides = {}) {
  return {
    onMove: vi.fn(),
    onOpenEdit: vi.fn(),
    onMoveSubcard: vi.fn(),
    onOpenEditSubcard: vi.fn(),
    onUploadImage: vi.fn(),
    onDeleteImage: vi.fn(),
    onAddSubtask: vi.fn(),
    ...overrides,
  };
}

describe('CardItem — variantes row e card renderizam a mesma informação', () => {
  it('variant "row" mostra título, imagens e badge/timestamp na linha', () => {
    const card = makeCard({
      imagens: [{ id: 1, url: '/board_uploads/42/print.png' }],
    });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.getByText(card.titulo)).not.toBeNull();
    expect(screen.getByTestId('image-thumb-1')).not.toBeNull();
    expect(screen.getByText('Bruno')).not.toBeNull();
    expect(screen.getByText(/há \d+h/)).not.toBeNull();
  });

  it('variant "card" mostra o mesmo título e imagens, com badge no footer', () => {
    const card = makeCard({
      imagens: [{ id: 2, url: '/board_uploads/42/print2.png' }],
    });
    render(<CardItem card={card} variant="card" {...baseProps()} />);

    expect(screen.getByText(card.titulo)).not.toBeNull();
    expect(screen.getByTestId('image-thumb-2')).not.toBeNull();
    expect(screen.getByText('Bruno')).not.toBeNull();
  });

  it('não mostra o botão de adicionar imagem na listagem, mesmo com card sem nenhuma imagem', () => {
    const card = makeCard({ imagens: [] });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
  });

  it('mostra as miniaturas de imagens existentes na listagem, sem o botão de adicionar', () => {
    const card = makeCard({
      imagens: [{ id: 1, url: '/board_uploads/42/print.png' }],
    });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.getByTestId('image-thumb-1')).not.toBeNull();
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
  });

  it('infere badge--claude/"Claude" quando ultima_atualizacao_por é "agente:claude"', () => {
    const card = makeCard({ ultima_atualizacao_por: 'agente:claude' });
    const { container } = render(<CardItem card={card} variant="row" {...baseProps()} />);

    const badge = container.querySelector('.badge--claude');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Claude');
  });

  it('cai em badge--none com o agent_id cru quando não reconhece a IA', () => {
    const card = makeCard({ ultima_atualizacao_por: 'agente:bot-customizado' });
    const { container } = render(<CardItem card={card} variant="card" {...baseProps()} />);

    const badge = container.querySelector('.badge--none');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('bot-customizado');
  });
});

describe('CardItem — contador de subcards', () => {
  it('card sem subcards (subcards_resumo: null) mostra o botão + subtarefa no lugar do contador', () => {
    const card = makeCard({ subcards_resumo: null, subcards: [] });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.queryByText(/subtarefas/)).toBeNull();
    expect(screen.getByText('+ subtarefa')).not.toBeNull();
  });

  it('tocar no botão + subtarefa vazio chama onAddSubtask(card.id) sem expandir nada', () => {
    const card = makeCard({ subcards_resumo: null, subcards: [] });
    const onAddSubtask = vi.fn();
    render(<CardItem card={card} variant="row" {...baseProps({ onAddSubtask })} />);

    fireEvent.click(screen.getByText('+ subtarefa'));

    expect(onAddSubtask).toHaveBeenCalledWith(42);
    // Nada de SubcardRow renderizado — não houve expansão, só a chamada direta.
    expect(screen.queryByText('Testar em Safari')).toBeNull();
  });

  it('card que ganha a 1ª subtarefa troca o botão vazio pelo counterRow', () => {
    const card = makeCard({ subcards_resumo: { total: 1, feitos: 0 } });
    const { rerender } = render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.getByText('0/1 subtarefas')).not.toBeNull();
    expect(screen.queryByText('+ subtarefa')).toBeNull();

    const emptyCard = makeCard({ subcards_resumo: null, subcards: [] });
    rerender(<CardItem card={emptyCard} variant="row" {...baseProps()} />);

    expect(screen.queryByText(/subtarefas/)).toBeNull();
    expect(screen.getByText('+ subtarefa')).not.toBeNull();
  });

  it('card que perde a última subtarefa volta a mostrar o botão vazio (regressão)', () => {
    const card = makeCard({ subcards_resumo: { total: 1, feitos: 1 } });
    const { rerender } = render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.getByText('1/1 subtarefas')).not.toBeNull();

    const emptyCard = makeCard({ subcards_resumo: null, subcards: [] });
    rerender(<CardItem card={emptyCard} variant="row" {...baseProps()} />);

    expect(screen.queryByText(/subtarefas/)).toBeNull();
    expect(screen.getByText('+ subtarefa')).not.toBeNull();
  });

  it('mostra "3/7 subtarefas" com cor --text-muted quando nem tudo está feito', () => {
    const card = makeCard({ subcards_resumo: { total: 7, feitos: 3 } });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    const counter = screen.getByText('3/7 subtarefas');
    expect(counter).not.toBeNull();
    expect(counter.closest('button').style.color).toBe('var(--text-muted)');
  });

  it('muda a cor para --accent-green quando feitos === total (todas concluídas)', () => {
    const card = makeCard({ subcards_resumo: { total: 4, feitos: 4 } });
    render(<CardItem card={card} variant="card" {...baseProps()} />);

    const counter = screen.getByText('4/4 subtarefas');
    expect(counter.closest('button').style.color).toBe('var(--accent-green)');
  });
});

describe('CardItem — expandir/recolher subcards (estado local)', () => {
  function cardWithSubcards() {
    return makeCard({
      status: 'em_andamento',
      subcards_resumo: { total: 2, feitos: 1 },
      subcards: [
        { id: 'sub-1', titulo: 'Testar em Safari', status: 'feito' },
        { id: 'sub-2', titulo: 'Ajustar line-height', status: 'a_fazer' },
      ],
    });
  }

  it('começa recolhido — não mostra SubcardRow nem "+ subtarefa"', () => {
    render(<CardItem card={cardWithSubcards()} variant="row" {...baseProps()} />);

    expect(screen.queryByText('Testar em Safari')).toBeNull();
    expect(screen.queryByText('Ajustar line-height')).toBeNull();
    expect(screen.queryByText('+ subtarefa')).toBeNull();
    expect(screen.getByText('1/2 subtarefas')).not.toBeNull();
  });

  it('tocar no contador expande e mostra um SubcardRow por subcard + "+ subtarefa"', () => {
    render(<CardItem card={cardWithSubcards()} variant="row" {...baseProps()} />);

    fireEvent.click(screen.getByText('1/2 subtarefas'));

    expect(screen.getByText('Testar em Safari')).not.toBeNull();
    expect(screen.getByText('Ajustar line-height')).not.toBeNull();
    expect(screen.getByText('+ subtarefa')).not.toBeNull();
  });

  it('tocar de novo recolhe (toggle local)', () => {
    render(<CardItem card={cardWithSubcards()} variant="row" {...baseProps()} />);

    const counter = screen.getByText('1/2 subtarefas');
    fireEvent.click(counter);
    expect(screen.getByText('Testar em Safari')).not.toBeNull();

    fireEvent.click(screen.getByText('1/2 subtarefas'));
    expect(screen.queryByText('Testar em Safari')).toBeNull();
  });
});

describe('CardItem — pill de status / MoveCardMenu', () => {
  it('tocar o pill de status abre o MoveCardMenu', () => {
    const card = makeCard({ status: 'a_fazer' });
    render(<CardItem card={card} variant="row" {...baseProps()} />);

    expect(screen.queryByText('Mover para...')).toBeNull();
    fireEvent.click(screen.getByLabelText('Mover: A Fazer'));
    expect(screen.getByText('Mover para...')).not.toBeNull();
  });

  it('escolher uma opção chama onMove(card.id, novoStatus) e fecha o menu', () => {
    const card = makeCard({ status: 'a_fazer' });
    const onMove = vi.fn();
    render(<CardItem card={card} variant="card" {...baseProps({ onMove })} />);

    fireEvent.click(screen.getByLabelText('Mover: A Fazer'));
    fireEvent.click(screen.getByText('Feito'));

    expect(onMove).toHaveBeenCalledWith(42, 'feito');
    expect(screen.queryByText('Mover para...')).toBeNull();
  });
});

describe('CardItem — título abre edição', () => {
  it('tocar no título chama onOpenEdit(card.id)', () => {
    const card = makeCard();
    const onOpenEdit = vi.fn();
    render(<CardItem card={card} variant="row" {...baseProps({ onOpenEdit })} />);

    fireEvent.click(screen.getByText(card.titulo));

    expect(onOpenEdit).toHaveBeenCalledWith(42);
  });
});

describe('CardItem — "+ subtarefa"', () => {
  it('tocar em "+ subtarefa" (expandido) chama onAddSubtask(card.id)', () => {
    const card = makeCard({
      subcards_resumo: { total: 1, feitos: 0 },
      subcards: [{ id: 'sub-1', titulo: 'Fazer algo', status: 'a_fazer' }],
    });
    const onAddSubtask = vi.fn();
    render(<CardItem card={card} variant="card" {...baseProps({ onAddSubtask })} />);

    fireEvent.click(screen.getByText('0/1 subtarefas'));
    fireEvent.click(screen.getByText('+ subtarefa'));

    expect(onAddSubtask).toHaveBeenCalledWith(42);
  });
});

describe('CardItem — variant "card": footer sempre por último no DOM', () => {
  it('mantém badge + pill de status como últimos filhos mesmo com imagens e subcards expandidos', () => {
    const card = makeCard({
      status: 'em_andamento',
      imagens: [
        { id: 1, url: '/img1.png' },
        { id: 2, url: '/img2.png' },
      ],
      subcards_resumo: { total: 2, feitos: 1 },
      subcards: [
        { id: 'sub-1', titulo: 'Sub A', status: 'feito' },
        { id: 'sub-2', titulo: 'Sub B', status: 'a_fazer' },
      ],
    });
    const { container } = render(<CardItem card={card} variant="card" {...baseProps()} />);

    // Expande os subcards para empilhar o máximo de conteúdo possível acima
    // do footer antes de checar a posição.
    fireEvent.click(screen.getByText('1/2 subtarefas'));
    expect(screen.getByText('Sub A')).not.toBeNull();

    const cardRoot = container.querySelector('[data-testid="card-item-42"]');
    const lastChild = cardRoot.lastElementChild;

    // O último filho direto do card é o footer (badge + pill de status), não
    // o MoveCardMenu (que só monta algo no DOM quando aberto — aqui está
    // fechado, então `MoveCardMenu` retorna null e não conta como filho).
    const footerScope = within(lastChild);
    expect(footerScope.getByText('Bruno')).not.toBeNull();
    expect(footerScope.getByLabelText('Mover: Em Andamento')).not.toBeNull();
  });
});

describe('CardItem — badge de cliente (clienteBadgeLabel)', () => {
  it('variant "row": mostra a badge de cliente quando clienteBadgeLabel é uma string', () => {
    const card = makeCard();
    const { container } = render(
      <CardItem card={card} variant="row" clienteBadgeLabel="Cliente 1" {...baseProps()} />
    );
    const badge = container.querySelector('.badge--cliente');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Cliente 1');
  });

  it('variant "row": não mostra a badge de cliente quando clienteBadgeLabel é null', () => {
    const card = makeCard();
    const { container } = render(
      <CardItem card={card} variant="row" clienteBadgeLabel={null} {...baseProps()} />
    );
    expect(container.querySelector('.badge--cliente')).toBeNull();
  });

  it('variant "row": não mostra a badge de cliente quando a prop nem é passada (default undefined)', () => {
    const card = makeCard();
    const { container } = render(<CardItem card={card} variant="row" {...baseProps()} />);
    expect(container.querySelector('.badge--cliente')).toBeNull();
  });

  it('variant "card": mostra a badge de cliente no footer, ao lado do badge de origem', () => {
    const card = makeCard();
    const { container } = render(
      <CardItem card={card} variant="card" clienteBadgeLabel="Podesubir" {...baseProps()} />
    );
    const badge = container.querySelector('.badge--cliente');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Podesubir');
    expect(container.querySelector('.badge--none')).not.toBeNull();
  });

  it('badge de cliente com o nome do cliente (modo "Todos") coexiste com o badge de origem (Bruno/agente) sem substituí-lo', () => {
    const card = makeCard({ ultima_atualizacao_por: 'agente:claude' });
    const { container } = render(
      <CardItem card={card} variant="row" clienteBadgeLabel="Cliente 1" {...baseProps()} />
    );
    expect(container.querySelector('.badge--cliente').textContent).toBe('Cliente 1');
    expect(container.querySelector('.badge--claude').textContent).toBe('Claude');
  });
});

describe('CardItem — vínculo de onUploadImage/onDeleteImage a card.id', () => {
  it('chama onDeleteImage(card.id, imageId) ao excluir uma miniatura', () => {
    const onDeleteImage = vi.fn();
    const card = makeCard({ imagens: [{ id: 7, url: '/img7.png' }] });
    render(<CardItem card={card} variant="row" {...baseProps({ onDeleteImage })} />);

    fireEvent.click(screen.getByLabelText('Excluir imagem'));

    expect(onDeleteImage).toHaveBeenCalledWith(42, 7);
  });
});
