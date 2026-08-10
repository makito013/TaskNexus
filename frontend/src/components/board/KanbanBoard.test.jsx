// frontend/src/components/board/KanbanBoard.test.jsx
// Covers Tarefa 24 (05-TL.md) / 05-DESIGNER.md seção 4 / 05-mockup.html
// (.board-cols-header/.lane/.lane-head/.col/.placeholder-col): swimlane por
// projeto, 4 colunas fixas, cabeçalho de coluna único pro board inteiro
// (não repetido por lane), placeholder tracejado pra coluna vazia, colapso
// de lane local por lane.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { KanbanBoard } from './KanbanBoard.jsx';

afterEach(() => cleanup());

function makeCard(overrides = {}) {
  return {
    id: 1,
    titulo: 'Card de teste',
    projeto_id: 'podesubir',
    parent_id: null,
    status: 'a_fazer',
    origem: 'bruno',
    ultima_atualizacao_por: 'bruno',
    descricao: null,
    criado_em: 1700000000,
    atualizado_em: Math.floor(Date.now() / 1000) - 3600,
    subcards: [],
    subcards_resumo: null,
    imagens: [],
    ...overrides,
  };
}

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

const PROJETOS = [
  { id: 'podesubir', nome: 'Pode Subir' },
  { id: 'escritorio-agentes', nome: 'Escritório de Agentes' },
];

describe('KanbanBoard — swimlanes por projeto', () => {
  it('renderiza uma swimlane por projeto presente em cards, com nome resolvido via projetos', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir', titulo: 'Card A' }),
      makeCard({ id: 2, projeto_id: 'escritorio-agentes', titulo: 'Card B' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    expect(screen.getByText('Pode Subir')).not.toBeNull();
    expect(screen.getByText('Escritório de Agentes')).not.toBeNull();
    expect(screen.getByTestId('lane-podesubir')).not.toBeNull();
    expect(screen.getByTestId('lane-escritorio-agentes')).not.toBeNull();
  });

  it('cai no projeto_id cru quando não encontra o projeto em projetos (fallback)', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'projeto-fantasma' })];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    expect(screen.getByText('projeto-fantasma')).not.toBeNull();
  });

  it('cada lane mostra a contagem total de cards do projeto', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir', status: 'a_fazer' }),
      makeCard({ id: 2, projeto_id: 'podesubir', status: 'feito' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    const lane = screen.getByTestId('lane-podesubir');
    expect(within(lane).getByText('2')).not.toBeNull();
  });
});

describe('KanbanBoard — distribuição de cards nas colunas por status', () => {
  it('cada card de topo vai para a coluna correspondente ao seu status', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir', status: 'a_fazer', titulo: 'Card Fazer' }),
      makeCard({ id: 2, projeto_id: 'podesubir', status: 'em_andamento', titulo: 'Card Andamento' }),
      makeCard({ id: 3, projeto_id: 'podesubir', status: 'em_revisao', titulo: 'Card Revisao' }),
      makeCard({ id: 4, projeto_id: 'podesubir', status: 'feito', titulo: 'Card Feito' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    expect(
      within(screen.getByTestId('col-podesubir-a_fazer')).getByText('Card Fazer')
    ).not.toBeNull();
    expect(
      within(screen.getByTestId('col-podesubir-em_andamento')).getByText('Card Andamento')
    ).not.toBeNull();
    expect(
      within(screen.getByTestId('col-podesubir-em_revisao')).getByText('Card Revisao')
    ).not.toBeNull();
    expect(
      within(screen.getByTestId('col-podesubir-feito')).getByText('Card Feito')
    ).not.toBeNull();
  });

  it('não mistura cards de projetos diferentes na mesma coluna', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir', status: 'a_fazer', titulo: 'Card P1' }),
      makeCard({ id: 2, projeto_id: 'escritorio-agentes', status: 'a_fazer', titulo: 'Card P2' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    const colP1 = screen.getByTestId('col-podesubir-a_fazer');
    const colP2 = screen.getByTestId('col-escritorio-agentes-a_fazer');
    expect(within(colP1).getByText('Card P1')).not.toBeNull();
    expect(within(colP1).queryByText('Card P2')).toBeNull();
    expect(within(colP2).getByText('Card P2')).not.toBeNull();
    expect(within(colP2).queryByText('Card P1')).toBeNull();
  });
});

describe('KanbanBoard — coluna vazia', () => {
  it('mostra o placeholder "Sem cards aqui" quando não há card naquele status/projeto', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'podesubir', status: 'a_fazer' })];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    const colVazia = screen.getByTestId('col-podesubir-feito');
    expect(within(colVazia).getByText('Sem cards aqui')).not.toBeNull();

    const colComCard = screen.getByTestId('col-podesubir-a_fazer');
    expect(within(colComCard).queryByText('Sem cards aqui')).toBeNull();
  });
});

describe('KanbanBoard — colapsar lane', () => {
  it('colapsar uma lane esconde suas colunas, mantendo outras lanes intactas', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir', titulo: 'Card P1' }),
      makeCard({ id: 2, projeto_id: 'escritorio-agentes', titulo: 'Card P2' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    expect(screen.getByText('Card P1')).not.toBeNull();
    expect(screen.getByText('Card P2')).not.toBeNull();

    fireEvent.click(screen.getByText('Pode Subir'));

    expect(screen.queryByTestId('col-podesubir-a_fazer')).toBeNull();
    expect(screen.queryByText('Card P1')).toBeNull();
    // a outra lane continua de pé, intacta
    expect(screen.getByTestId('col-escritorio-agentes-a_fazer')).not.toBeNull();
    expect(screen.getByText('Card P2')).not.toBeNull();
    expect(screen.getByTestId('lane-podesubir')).not.toBeNull();
  });

  it('clicar de novo na lane colapsada expande novamente', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'podesubir', titulo: 'Card P1' })];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    const laneHead = screen.getByText('Pode Subir');
    fireEvent.click(laneHead);
    expect(screen.queryByText('Card P1')).toBeNull();

    fireEvent.click(laneHead);
    expect(screen.getByText('Card P1')).not.toBeNull();
  });
});

describe('KanbanBoard — badge de cliente (feature Cliente/Projeto)', () => {
  const PROJETOS_COM_SUBPROJETOS = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
    { id: 'podesubir', nome: 'Pode Subir', sub_projetos: [] },
  ];

  it('mostra a badge "Cliente" num card cliente-only cujo cliente tem subprojetos', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'cliente_projeto_1', titulo: 'Card cliente-only' })];
    render(<KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} {...baseProps()} />);

    expect(screen.getByText('Cliente')).not.toBeNull();
  });

  it('não mostra a badge num card de cliente-como-projeto (sem subprojetos)', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'podesubir', titulo: 'Card comum' })];
    render(<KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} {...baseProps()} />);

    expect(screen.queryByText('Cliente')).toBeNull();
  });

  it('agrupa um card cliente-only ("cliente_projeto_1") na lane do próprio cliente, não numa lane separada', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'cliente_projeto_1', titulo: 'Card cliente-only' }),
      makeCard({ id: 2, projeto_id: 'cliente_projeto_1/subprojeto_1', titulo: 'Card do subprojeto' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} {...baseProps()} />);

    expect(screen.getByTestId('lane-cliente_projeto_1')).not.toBeNull();
    expect(screen.getByTestId('lane-cliente_projeto_1/subprojeto_1')).not.toBeNull();
    expect(
      within(screen.getByTestId('col-cliente_projeto_1-a_fazer')).getByText('Card cliente-only')
    ).not.toBeNull();
  });

  it('não mostra a badge num card vinculado a um projeto de nível 2+ que também tem subprojetos (hierarquia de 3 níveis, bug do QA)', () => {
    const PROJETOS_3_NIVEIS = [
      {
        id: 'cliente-x/projeto-y',
        nome: 'Projeto Y',
        sub_projetos: ['cliente-x/projeto-y/sub-z'],
      },
      { id: 'cliente-x/projeto-y/sub-z', nome: 'Sub Z', sub_projetos: [] },
    ];
    const cards = [
      makeCard({ id: 1, projeto_id: 'cliente-x/projeto-y', titulo: 'Card do projeto-y' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS_3_NIVEIS} {...baseProps()} />);

    expect(screen.queryByText('Cliente')).toBeNull();
  });
});

describe('KanbanBoard — showAllClientes (feature Clientes na sidebar v2, filtro "Todos")', () => {
  const PROJETOS_COM_SUBPROJETOS = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', sub_projetos: [] },
    { id: 'podesubir', nome: 'Pode Subir', sub_projetos: [] },
  ];

  it('default (sem passar showAllClientes): preserva o comportamento antigo — só cliente-only ambíguo ganha badge (não-regressão)', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'cliente_projeto_1', titulo: 'Card cliente-only' }),
      makeCard({ id: 2, projeto_id: 'cliente_projeto_1/subprojeto_1', titulo: 'Card do subprojeto' }),
      makeCard({ id: 3, projeto_id: 'podesubir', titulo: 'Card cliente-como-projeto' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} {...baseProps()} />);

    // Só 1 badge "Cliente" no board inteiro (card cliente-only), mesmo com
    // 3 cards de "níveis" diferentes presentes.
    expect(screen.getAllByText('Cliente')).toHaveLength(1);
  });

  it('showAllClientes=true: TODO card ganha uma badge com o nome do cliente, inclusive card vinculado a um sub-projeto específico', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'cliente_projeto_1', titulo: 'Card cliente-only' }),
      makeCard({ id: 2, projeto_id: 'cliente_projeto_1/subprojeto_1', titulo: 'Card do subprojeto' }),
      makeCard({ id: 3, projeto_id: 'podesubir', titulo: 'Card cliente-como-projeto' }),
    ];
    render(
      <KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} showAllClientes {...baseProps()} />
    );

    const laneCliente1 = screen.getByTestId('lane-cliente_projeto_1');
    const laneSubprojeto1 = screen.getByTestId('lane-cliente_projeto_1/subprojeto_1');
    const lanePodesubir = screen.getByTestId('lane-podesubir');

    // Card cliente-only: badge com o próprio nome do cliente. A lane
    // "cliente_projeto_1" também mostra "Cliente 1" no cabeçalho da lane (laneName),
    // então a busca é escopada pra classe da badge, não pro texto solto.
    expect(within(laneCliente1).getByText('Cliente 1', { selector: '.badge--cliente' })).not.toBeNull();
    // Card do subprojeto: badge com o nome do cliente-PAI (Cliente 1), não
    // "Subprojeto 1" — mesma regra de resolveClienteBadgeLabel. Aqui o cabeçalho da
    // lane é "Subprojeto 1" (nome do próprio subprojeto), sem ambiguidade.
    expect(within(laneSubprojeto1).getByText('Cliente 1')).not.toBeNull();
    // Card cliente-como-projeto (sem sub_projetos, nunca ganhava badge antes
    // de showAllClientes existir): também ganha a badge em modo "Todos". O
    // cabeçalho da lane já é "Pode Subir" também, mesma ambiguidade de nome.
    expect(within(lanePodesubir).getByText('Pode Subir', { selector: '.badge--cliente' })).not.toBeNull();
  });

  it('showAllClientes=true não some com o badge de origem (Bruno/agente) — os dois coexistem', () => {
    const cards = [makeCard({ id: 1, projeto_id: 'podesubir', ultima_atualizacao_por: 'agente:claude' })];
    const { container } = render(
      <KanbanBoard cards={cards} projetos={PROJETOS_COM_SUBPROJETOS} showAllClientes {...baseProps()} />
    );
    expect(container.querySelector('.badge--cliente').textContent).toBe('Pode Subir');
    expect(container.querySelector('.badge--claude').textContent).toBe('Claude');
  });
});

describe('KanbanBoard — header de colunas único', () => {
  it('header de 4 colunas aparece uma única vez no documento, não repetido por lane', () => {
    const cards = [
      makeCard({ id: 1, projeto_id: 'podesubir' }),
      makeCard({ id: 2, projeto_id: 'escritorio-agentes' }),
    ];
    render(<KanbanBoard cards={cards} projetos={PROJETOS} {...baseProps()} />);

    expect(screen.getAllByTestId('board-cols-header')).toHaveLength(1);
    expect(screen.getAllByText('A Fazer')).toHaveLength(1);
    expect(screen.getAllByText('Em Andamento')).toHaveLength(1);
    expect(screen.getAllByText('Em Revisão')).toHaveLength(1);
    expect(screen.getAllByText('Feito')).toHaveLength(1);
  });
});
