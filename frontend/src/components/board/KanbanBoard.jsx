// frontend/src/components/board/KanbanBoard.jsx
// Visão Board (Kanban) — Tarefa 24 do plano 05-TL.md, seção 4 do
// 05-DESIGNER.md e estrutura visual de 05-mockup.html
// (`.board-cols-header`/`.lane`/`.lane-head`/`.col`/`.placeholder-col`).
//
// Este componente só AGRUPA e RENDERIZA — o filtro por projeto já foi
// aplicado por quem passa `cards` (BoardView, Tarefa 26); aqui a única
// responsabilidade é: (1) desenhar o cabeçalho de 4 colunas UMA VEZ SÓ pro
// board inteiro (não repetido por swimlane — "para não repetir texto quando
// há muitos projetos", 05-DESIGNER.md seção 4), e (2) uma swimlane por
// `projeto_id` presente em `cards`, com os cards de topo daquele projeto
// distribuídos nas 4 colunas conforme `status`.
//
// Decisão — botão "Limpar concluídos" NÃO está aqui: a lista de props desta
// tarefa (05-TL.md Tarefa 24) não inclui `onClearFinished`/contagem de
// "feito" por lane, ao contrário do que o mockup mostra no `.lane-head`
// (Tarefa 25/26 — `ClearFinishedModal`/`BoardView` — são donas desse botão
// e da lógica de "habilitado só quando há `feito` no projeto"). Reproduzo o
// resto do `.lane-head` (chevron, nome, contagem) mas deixo esse gatilho de
// fora deliberadamente, para não inventar um contrato de prop que a Tarefa
// 26 ainda vai definir.
//
// Decisão — agrupamento por `projeto_id` é local (Map), não vem pré-agrupado
// do backend nem de outro hook: `cards` chega como lista plana de múltiplos
// projetos (ADR-8, useCards.js já devolve assim), e a ORDEM das lanes segue
// a ordem de PRIMEIRA APARIÇÃO de cada `projeto_id` em `cards` (mesmo
// espírito de "não reordenar o que já veio pronto" usado em outros pontos
// do Board) — não ordena alfabeticamente por nome resolvido, porque isso
// mudaria a ordem cada vez que o nome de exibição mudasse, e o dado de
// entrada já reflete a ordem que a API retornou.
//
// Decisão — nome de exibição da lane: resolve `projeto_id` em `projetos`
// (por `id`); se não encontrar (projeto desconhecido/removido depois de o
// card existir — mesmo cenário do "Projeto desconhecido" da visão Tarefas
// global, achado #4 do TL), cai no próprio `projeto_id` cru (slug), nunca
// esconde a lane.
//
// Decisão — estado de colapso é local por lane (`useState<Set<string>>`
// aqui neste componente, não em `BoardView`): mesmo padrão já fechado para
// `CardItem` (expansão de subcards é local, não sobe pro pai) — colapsar uma
// lane é puramente uma preferência de visualização momentânea desta tela,
// sem necessidade de persistir ou de o pai saber disso.
//
// Badge "Cliente" (feature Cliente/Projeto): uma restrição anterior que
// deixava mudanças parecidas fora de escopo neste arquivo está OBSOLETA —
// agora este componente também calcula, por card, `clienteBadgeLabel` via
// `resolveClienteBadgeLabel` (frontend/src/utils/clientes.js) e repassa como
// prop individual pro `CardItem`, mesma regra usada pela visão Lista em
// BoardView.jsx. Prop nova `showAllClientes` (default false, sincronizada
// pelo BoardView com `selectedClienteId == null` — sidebar v2, filtro
// "Todos"): quando false, preserva o comportamento antigo de
// `shouldShowClienteBadge` (as DUAS condições — id nível-cliente sem "/" E
// sub_projetos não-vazios — pra não marcar como "Cliente" um card vinculado a
// um projeto específico de 3+ níveis que por acaso também tem subpastas,
// achado do QA); quando true, TODO card ganha uma badge com o nome do
// cliente, pra identificar de qual cliente cada card é numa lista combinada
// de múltiplos clientes.

import { useState } from 'react';
import { CardItem } from './CardItem.jsx';
import { resolveClienteBadgeLabel } from '../../utils/clientes.js';

const STATUSES = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];

const STATUS_LABELS = {
  a_fazer: 'A Fazer',
  em_andamento: 'Em Andamento',
  em_revisao: 'Em Revisão',
  feito: 'Feito',
};

const STATUS_BAR_COLOR = {
  a_fazer: 'var(--border-strong)',
  em_andamento: 'var(--accent-claude)',
  em_revisao: 'var(--state-attention)',
  feito: 'var(--accent-green)',
};

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
  },
  colsHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    display: 'grid',
    gridTemplateColumns: '180px repeat(4, 1fr)',
    gap: '10px',
    padding: '10px 16px 6px',
    background: 'var(--bg-base)',
  },
  colHead: (status) => ({
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-secondary)',
    paddingTop: '6px',
    borderTop: `3px solid ${STATUS_BAR_COLOR[status]}`,
  }),
  colHeadCount: {
    color: 'var(--text-muted)',
    fontWeight: 400,
    textTransform: 'none',
    letterSpacing: 0,
  },
  lane: {
    display: 'grid',
    gridTemplateColumns: '180px repeat(4, 1fr)',
    gap: '10px',
    padding: '4px 16px 18px',
    alignItems: 'start',
  },
  laneHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 4px',
    borderLeft: '2px solid var(--border-strong)',
    paddingLeft: '10px',
    background: 'transparent',
    border: 'none',
    borderLeftWidth: '2px',
    borderLeftStyle: 'solid',
    borderLeftColor: 'var(--border-strong)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  laneChev: {
    color: 'var(--text-muted)',
    fontSize: '10px',
  },
  laneName: {
    fontSize: '12px',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  laneCount: {
    fontSize: '10px',
    color: 'var(--text-muted)',
  },
  col: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minHeight: '60px',
  },
  placeholderCol: {
    border: '1px dashed var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 8px',
    textAlign: 'center',
    fontSize: '10px',
    color: 'var(--text-very-muted)',
  },
};

// Agrupa `cards` (lista plana, potencialmente de múltiplos projetos) em
// `[{ projetoId, cards }]`, na ordem de primeira aparição de cada projeto.
function groupByProject(cards) {
  const order = [];
  const byProject = new Map();
  for (const card of cards) {
    const projetoId = card.projeto_id;
    if (!byProject.has(projetoId)) {
      byProject.set(projetoId, []);
      order.push(projetoId);
    }
    byProject.get(projetoId).push(card);
  }
  return order.map((projetoId) => ({ projetoId, cards: byProject.get(projetoId) }));
}

function resolveProjectName(projetoId, projetos) {
  const found = (projetos || []).find((p) => p.id === projetoId);
  return found ? found.nome : projetoId;
}

export function KanbanBoard({
  cards,
  projetos,
  onMove,
  onOpenEdit,
  onMoveSubcard,
  onOpenEditSubcard,
  onUploadImage,
  onDeleteImage,
  onAddSubtask,
  showAllClientes = false,
}) {
  const [collapsedLanes, setCollapsedLanes] = useState(() => new Set());

  const lanes = groupByProject(cards || []);

  function toggleLane(projetoId) {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(projetoId)) {
        next.delete(projetoId);
      } else {
        next.add(projetoId);
      }
      return next;
    });
  }

  const cardItemProps = {
    onMove,
    onOpenEdit,
    onMoveSubcard,
    onOpenEditSubcard,
    onUploadImage,
    onDeleteImage,
    onAddSubtask,
  };

  return (
    <div style={styles.wrap} data-testid="kanban-board">
      <div style={styles.colsHeader} data-testid="board-cols-header">
        <div />
        {STATUSES.map((status) => (
          <div key={status} style={styles.colHead(status)}>
            {STATUS_LABELS[status]}{' '}
            <span style={styles.colHeadCount}>
              ({(cards || []).filter((c) => c.status === status).length})
            </span>
          </div>
        ))}
      </div>

      {lanes.map(({ projetoId, cards: laneCards }) => {
        const collapsed = collapsedLanes.has(projetoId);
        const projectName = resolveProjectName(projetoId, projetos);

        return (
          <div key={projetoId} style={{ display: 'contents' }}>
            <div style={styles.lane} data-testid={`lane-${projetoId}`}>
              <button
                type="button"
                style={styles.laneHead}
                onClick={() => toggleLane(projetoId)}
                aria-expanded={!collapsed}
              >
                <span style={styles.laneChev} aria-hidden="true">
                  {collapsed ? '▸' : '▾'}
                </span>
                <span style={styles.laneName}>{projectName}</span>
                <span style={styles.laneCount}>{laneCards.length}</span>
              </button>

              {!collapsed &&
                STATUSES.map((status) => {
                  const columnCards = laneCards.filter((c) => c.status === status);
                  return (
                    <div
                      key={status}
                      style={styles.col}
                      data-testid={`col-${projetoId}-${status}`}
                    >
                      {columnCards.length === 0 ? (
                        <div style={styles.placeholderCol}>Sem cards aqui</div>
                      ) : (
                        columnCards.map((card) => (
                          <CardItem
                            key={card.id}
                            card={card}
                            variant="card"
                            clienteBadgeLabel={resolveClienteBadgeLabel(card.projeto_id, projetos, showAllClientes)}
                            {...cardItemProps}
                          />
                        ))
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
