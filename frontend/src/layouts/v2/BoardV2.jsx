// frontend/src/layouts/v2/BoardV2.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): versão v2 do Board —
// kanban horizontal com scroll-x, uma coluna de 300px por status (não por
// projeto) — os STATUS eram fixos aqui até a task #43, ver nota de colunas
// dinâmicas logo abaixo. Reaproveita `useCards` (frontend/src/hooks/useCards.js) tal
// como está: mesmo hook, mesmas ações (createCard, updateCard) — só a
// apresentação muda, conforme instrução do Designer/TL para este milestone.
//
// Esta é a ÚNICA tela de Board do app: a rota `/board` e toda a árvore de
// componentes v1 que a servia foram removidas (decisão do Bruno, sessão
// "cards/board v2"), e o que só existia lá — "Limpar concluídos" — foi
// portado para cá (ver `clearTargetId` abaixo).
//
// Filtro de listagem/agregação: `selectedClienteId` vem do mesmo estado que
// AppV2.jsx já calcula pra sidebar de clientes (`handleSelectCliente`) e já
// repassa pra TarefasV2 — DESACOPLADO de `selectedProjectId` (o projeto do
// chat ativo no TerminalContext). A cascata Cliente -> Projeto agora mora em
// `useClienteProjetoFilter.js` (estado LOCAL desta tela, não toca o estado
// compartilhado com o chat) e é operada pela `ClienteProjetoFilterBar`: com a
// sidebar em "Todos", os dois selects aparecem; com um cliente já fixado na
// sidebar, só o select de Projeto. Sem cliente algum selecionado,
// `useCards([])` busca cards de TODOS os projetos (mesmo comportamento
// "Todos" de v1) e cada card mostra as tags de cliente/projeto pra dar
// contexto.
//
// Órfãos (decisão do Bruno, sessão "card/tarefa órfão"): `useCards([])`
// também é o que roda com um cliente FIXO enquanto o Tier 2 estiver em
// "Todos os projetos" — a restrição ao cliente vira um filtro de EXIBIÇÃO
// (client-side, por `clienteIdFromProjetoId`) em vez de ir na query, senão um
// card de projeto órfão (removido/desconhecido do disco) nunca apareceria
// (uma query escopada só conhece nós reais de `projects`). Ver comentário
// junto de `useCards(fetchProjectIds)` abaixo para o detalhe completo, e
// `useClienteProjetoFilter.js`/`utils/taskGroups.js` para a mesma decisão
// aplicada ao NOME de um cliente/projeto que não resolve (tag omitida, nunca
// o id cru).
//
// Card creation: each column's "+ Adicionar card" opens the `CardFormModal`
// in 'create' mode, with defaults taken from THIS screen's ACTIVE FILTER
// (`effectiveClienteId`/`selectedProjetoId`) and the status of the clicked
// column. The `selectedProjectId` prop (the active chat's project), once the
// only source of the creation target, is gone from the signature: it tied
// creation to the open chat and disabled the whole button when there was no
// chat at all ("Selecione um projeto na barra lateral"). Bruno now picks
// Cliente/Projeto inside the modal itself.
//
// Decisão — "mover card": o controle de mover é um `<select>` nativo simples
// chamando `updateCard(cardId, { status })` diretamente — apresentação nova e
// mínima (a especificação do Designer para este card não pede um menu
// específico, só que a ação exista).
//
// NÃO implementado nesta tela (ver relatório do Dev): contador de
// subtarefas/tira de imagens inline no rosto do card — a especificação de
// card do Designer para BoardV2 pede apenas título + descrição + avatar +
// tag. Não expandido silenciosamente: é um corte de escopo deliberado, não
// uma lacuna esquecida.
//
// Fase 4 (épico "visualização global de cards presa ao agente aberto"):
// clicar no título do card abre `CardFormModal` (components/board/) em modo
// 'edit' — dá a este layout a forma de ver/editar a descrição completa e
// anexar/remover imagem, que antes só existia na tela v1 removida.
// Continua sem exibir subcards nesta tela (decisão pré-existente acima):
// o modal em modo 'edit' só usa `card.subcards.length` para a contagem do
// aviso de exclusão em cascata, nunca renderiza a lista de subcards em si.
//
// Colunas dinâmicas (task #43, fase 1): as 4 colunas fixas por status saíram.
// `useColumns()` é a fonte de verdade — criar (coluna-fantasma no fim do
// scroller), renomear, marcar como concluída e excluir acontecem todos no
// header da própria coluna, as três últimas pelo menu "⋯".
//
// Arrastar coluna (task #43, fase 2): o CABEÇALHO INTEIRO de cada coluna é a
// superfície de arrasto — pega em qualquer ponto da barra e arrasta, como no
// Jira (decisão do Bruno depois de testar a fase 2 ao vivo; a primeira versão
// tinha um grip ⠿ dedicado de 28px, que ele achou pequeno demais para mirar).
// O botão "⋯" dentro do header continua clicável: os sensores só armam depois
// de 6px de movimento (mouse) ou 280ms segurando (touch), e um clique não
// cruza nenhum dos dois limiares. Renomear saiu do clique-no-título por causa
// disso e virou item do menu "⋯" (BoardColumnRenameDialog) — editar inline e
// arrastar disputariam os mesmos pixels.
//
// ⚠️ As setas ◀▶ da fase 1 foram REMOVIDAS a pedido do Bruno, que aceitou a
// troca de olhos abertos: eram o único caminho de reordenar por teclado, e
// como não há `KeyboardSensor` registrado aqui, hoje NÃO existe rota de
// teclado para reordenar coluna. Consciente e fora de escopo por ora — quem
// for resolver, o lugar é um KeyboardSensor no `DndContext` abaixo.
//
// Por baixo: dnd-kit, `DndContext` + `SortableContext` horizontal em volta do
// scroller, com `DragOverlay` portalado para `document.body`. O cálculo da
// nova ordem mora em `utils/boardColumnOrder.js` (puro, e é o que os testes
// exercitam de verdade — gesto de dnd-kit não é simulável em jsdom); o POST
// vai pelo `reorderColumns` de `useColumns`, otimista com rollback.
//
// Arrastar CARD (task #43, fase 3): o card inteiro é a superfície de arrasto e
// pode ser solto entre dois cards específicos, dentro da própria coluna ou em
// outra — posição fina estilo Jira, não só troca de coluna. Roda no MESMO
// `DndContext` do arrasto de coluna: os dois tipos de arrasto coexistem, e o
// que os mantém separados é o NAMESPACE DE ID (coluna = slug cru, card =
// `card:{id}`, área vazia de coluna = `dropzone:{slug}`) mais uma
// `collisionDetection` própria que só considera os alvos do tipo que está
// sendo arrastado. O cálculo dos vizinhos (`after_id`/`before_id`) mora em
// `utils/boardCardOrder.js` — puro, e é o que os testes exercitam de verdade.
//
// O `<select>` de status no rodapé do card CONTINUA existindo, e não é
// redundante: ele realoca pro FIM da coluna de destino (caminho do PATCH) e é
// a única rota de teclado pra mover um card, já que não há `KeyboardSensor`
// registrado aqui.
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SortableBoardColumn,
  isColumnDropzoneId,
  slugFromColumnDropzoneId,
} from '../../components/board/SortableBoardColumn.jsx';
import {
  SortableBoardCard,
  cardDndId,
  cardIdFromDndId,
  isCardDndId,
} from '../../components/board/SortableBoardCard.jsx';
import { reorderColumns as reorderSlugs } from '../../utils/boardColumnOrder.js';
import { computeCardDrop } from '../../utils/boardCardOrder.js';
import { BoardColumnDeleteDialog } from '../../components/board/BoardColumnDeleteDialog.jsx';
import { BoardColumnMenu } from '../../components/board/BoardColumnMenu.jsx';
import { BoardColumnRenameDialog } from '../../components/board/BoardColumnRenameDialog.jsx';
import { CardFormModal } from '../../components/board/CardFormModal.jsx';
import { CardIdBadge } from '../../components/board/CardIdBadge.jsx';
import { ClearFinishedModal } from '../../components/board/ClearFinishedModal.jsx';
import { useCards } from '../../hooks/useCards.js';
import { useColumns } from '../../hooks/useColumns.js';
import {
  CARD_TIPO_COLORS,
  CARD_TIPO_LABELS,
  formatPrazo,
  isPrazoAtrasado,
} from '../../utils/cardMeta.js';
import { clienteIdFromProjetoId } from '../../utils/clientes.js';
import { ClienteProjetoFilterBar } from './ClienteProjetoFilterBar.jsx';
import {
  resolveCardTags,
  resolveProjectName,
  useClienteProjetoFilter,
} from './useClienteProjetoFilter.js';

// How long a finger must rest on the drag surface before the drag arms, and
// how far it may wander in the meantime without cancelling.
//
// BOARD_, not COLUMN_: these feed the single `boardDragSensors` list, which
// governs BOTH drags since phase 3 — a column by its header, a card by its
// whole body. They were named for the column because for one phase it was the
// only thing draggable here.
//
// 280 is DELIBERATELY DUPLICATED from `LONG_PRESS_MS` in
// layouts/v2/TerminalShortcutsFab.jsx (~line 50) rather than imported. The two
// gestures are independent — that one toggles the shortcuts panel, this one
// picks something up off the board — and they share the number only because
// the same constraint produced it: comfortably under the ~500ms at which iOS
// Safari raises its own callout/selection, so the system never fights us for
// the gesture. Importing would make a future tuning of one silently retune the
// other.
const BOARD_DRAG_LONG_PRESS_MS = 280;
// Finger tremor during those 280ms. Independent of the FAB's own slop for the
// same reason as above.
const BOARD_DRAG_TOLERANCE_PX = 8;
// Mouse only: a few pixels of travel before a press becomes a drag. This is
// what keeps the controls INSIDE a drag surface clickable — the "⋯" button in
// a column header, and the card's title button and status select — because a
// plain click never travels far enough to arm anything.
const BOARD_DRAG_POINTER_DISTANCE_PX = 6;

// dnd-kit ships English screen-reader strings and mounts its live region
// unconditionally, so it announces during POINTER drags too — not only
// keyboard ones. Left alone, a pt-BR board would speak English, and the
// default instructions describe a space-bar/arrow-key drag this build does not
// implement (the sensor list is Pointer + Touch, with no KeyboardSensor).
//
// `draggable` is the text dnd-kit puts in its hidden instructions node. That
// node is only read when something references it, and nothing does any more
// (SortableBoardColumn drops `aria-describedby` — see the block there), so
// this is belt-and-braces: correct if anything ever points at it again.
const BOARD_DND_SCREEN_READER_INSTRUCTIONS = {
  // Says only what is true: dragging works, and nothing else does. It no
  // longer points at the ◀▶ arrows, which have been removed — promising a
  // keyboard route that does not exist is the failure that whole round was
  // about. Phase 3 appends the card half of the same sentence, and keeps the
  // same discipline: the card's status `<select>` is named because it really
  // is the keyboard route for moving a card between columns.
  draggable: 'Para reordenar, arraste o cabeçalho da coluna. Para reposicionar '
    + 'um card, arraste o card. Sem arrastar, use o seletor de coluna no pé do '
    + 'card.',
};

// `active.id`/`over.id` are RAW SORTABLE IDS — a bare slug for a column,
// `card:{id}` for a card, `dropzone:{slug}` for a column's empty area — and
// none of them is speakable. `describe` resolves any of the three to what the
// user actually reads on screen, falling back to the id only if the thing it
// names vanished mid-drag.
function buildBoardDndAnnouncements(describe) {
  return {
    onDragStart: ({ active }) => `${describe(active.id)} levantado.`,
    onDragOver: ({ active, over }) => (over
      ? `${describe(active.id)} sobre ${describe(over.id)}.`
      : `${describe(active.id)} fora de qualquer posição válida.`),
    onDragEnd: ({ active, over }) => (over
      ? `${describe(active.id)} solto sobre ${describe(over.id)}.`
      : `${describe(active.id)} solto fora do board. Nada mudou.`),
    onDragCancel: ({ active }) => `Movimento de ${describe(active.id)} cancelado.`,
  };
}

// One DndContext holds both kinds of drag, so collisions have to be filtered
// by KIND — this is the risk the plan named. `closestCenter` alone ranks every
// registered droppable by distance, and with a horizontal row of 300px columns
// overlapping vertical lists of cards it will happily report a column as the
// best match for a card drag (and vice versa).
//
// Dragging a card considers ONLY card and dropzone targets; dragging a column
// considers ONLY columns. Then, for a card:
//
// - `pointerWithin` first, because it returns only the targets actually under
//   the pointer. That is what makes "drop into the empty column over there"
//   work: a distance-ranked list always has a nearest card somewhere on the
//   board, even when the finger is nowhere near it.
// - a CARD wins over the column's dropzone when both are under the pointer.
//   The dropzone covers the whole body, cards included, so without this
//   preference every drop would read as "dropped in empty space" and land at
//   the end of the column.
// - and there is NO distance-based fallback for a card. `pointerWithin`
//   returning nothing is a MEANINGFUL answer — the finger is in the gap
//   between two columns, on the header row, or off the board entirely — and
//   the product rule for that is "cancel, no request". A `closestCenter`
//   fallback would instead pick the nearest card ANYWHERE on the board and
//   move it, turning a release that meant "never mind" into a silent rewrite
//   of the vertical order Bruno arranged by hand. Un-droppable is the
//   specified behaviour here, not a gap to paper over.
//
// The column branch keeps plain `closestCenter`: that is phase 2's shipped,
// manually validated behaviour, and a column drop has no "between two things"
// to get wrong.
// Exported ONLY for its own test. The geometry it delegates to (`pointerWithin`
// / `closestCenter`) is meaningless in jsdom — every rect is zeros — but the
// DECISIONS above it are ours and are worth pinning: which containers each kind
// of drag may even consider, that a card beats a dropzone, and above all that
// an empty `pointerWithin` stays empty instead of falling back to a distance
// match. See BoardV2.collision.test.jsx.
export function buildBoardCollisionDetection(args) {
  const draggingCard = isCardDndId(args.active?.id);
  const candidates = args.droppableContainers.filter((container) => {
    const isCardTarget = isCardDndId(container.id) || isColumnDropzoneId(container.id);
    return draggingCard ? isCardTarget : !isCardTarget;
  });
  const filtered = { ...args, droppableContainers: candidates };

  if (!draggingCard) return closestCenter(filtered);

  const under = pointerWithin(filtered);
  if (!under.length) return [];
  const onACard = under.find((collision) => isCardDndId(collision.id));
  return onACard ? [onACard] : under;
}

// Reorder feedback is a border FLASH, not a position animation: the columns
// swap instantly in the flex row (animating a 300px-wide box sliding past
// another reads as lag, not as motion), and the moved column identifies itself
// by pulsing its border. Keyframes cannot live in an inline style object, so
// this is injected once as a real stylesheet by the component below.
const COLUMN_FLASH_CSS = `
@keyframes v2-column-flash {
  from { border-color: var(--v2-accent); }
  to { border-color: var(--v2-border); }
}
.v2-column-flash {
  animation: v2-column-flash 200ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .v2-column-flash { animation: none; }
}
`;

const styles = {
  page: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--v2-bg)',
  },
  // Header row of this screen only: the shared ClienteProjetoFilterBar on the
  // left, this board's own actions on the right. The bar is NOT the owner of
  // this row — it returns `null` whenever the sidebar fixed a client with no
  // subprojects, and it is also mounted by TarefasV2, where a card action
  // would make no sense. Neither box carries the row's bottom rule: each
  // carries its own, and `headerActions` grows to fill whatever the bar leaves
  // (including the whole row when the bar renders nothing), so the two borders
  // read as one continuous line either way.
  headerRow: {
    display: 'flex',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  headerActions: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '10px 16px',
    borderBottom: '1px solid var(--v2-border)',
  },
  clearBtn: (disabled) => ({
    flexShrink: 0,
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-3)',
    color: 'var(--v2-text-dim)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    // The inline color/background would otherwise override the UA's greying of
    // a disabled control — same reason the filter bar's selects dim themselves.
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  scroller: {
    flex: 1,
    display: 'flex',
    gap: '14px',
    padding: '16px',
    overflowX: 'auto',
    overflowY: 'hidden',
    alignItems: 'flex-start',
  },
  // `isDone` swaps the border colour for the accent — the done column is the
  // one every other feature keys off (subcard summary, late-deadline rule,
  // "limpar concluídos"), so it has to be identifiable at a glance without
  // opening a menu. The "✓" pill next to the title carries the same meaning
  // for anyone who cannot perceive the border colour.
  column: (isDone) => ({
    width: '300px',
    minWidth: '300px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--v2-surface)',
    border: `1px solid ${isDone ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    borderRadius: '12px',
    height: '100%',
    overflow: 'hidden',
  }),
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '12px 10px 12px 14px',
    borderBottom: '1px solid var(--v2-border)',
    flexShrink: 0,
  },
  // Plain text since renaming moved to the "⋯" menu — no button reset, no
  // pointer cursor. The header's own `cursor: grab` applies here too, which is
  // right: the title is part of the drag surface like the rest of the bar.
  columnTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  columnCount: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
    flexShrink: 0,
  },
  // Same vocabulary as `tipoChip`: soft accent background, strong accent text.
  doneBadge: {
    padding: '2px 6px',
    borderRadius: '6px',
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: 1.4,
    flexShrink: 0,
  },
  // The element that follows the pointer. Header only — carrying the whole
  // card list would make a heavy, laggy object and say nothing extra about
  // where it is going. Raised with the existing shadow token so it reads as
  // lifted off the board rather than as another column in the row.
  dragOverlayColumn: (isDone) => ({
    width: '300px',
    background: 'var(--v2-surface)',
    border: `1px solid ${isDone ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    borderRadius: '12px',
    boxShadow: 'var(--v2-shadow-lg)',
    cursor: 'grabbing',
    overflow: 'hidden',
  }),
  // Ghost column: the "+ nova coluna" affordance, narrower than a real column
  // and dashed so it never reads as a column that simply has no cards.
  ghostColumn: {
    width: '120px',
    minWidth: '120px',
    display: 'flex',
    alignItems: 'flex-start',
    padding: '12px 10px',
    border: '1px dashed var(--v2-border)',
    borderRadius: '12px',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '12px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  ghostInput: {
    width: '120px',
    minWidth: '120px',
    padding: '12px 10px',
    border: '1px solid var(--v2-accent)',
    borderRadius: '12px',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    font: 'inherit',
    fontSize: '12px',
    flexShrink: 0,
  },
  // `isCardOver` is the cue for an EMPTY column, which has no card for the
  // drop indicator line to sit above. A populated column gets the line instead
  // and leaves this alone.
  columnBody: (isCardOver) => ({
    flex: 1,
    overflowY: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderRadius: '8px',
    outline: isCardOver ? '1px dashed var(--v2-accent)' : 'none',
    outlineOffset: '-4px',
  }),
  // The drop indicator: a thin accent rule at the exact slot the card will
  // land in. It is rendered from the SAME `computeCardDrop` result the drop
  // will send to the server, so it cannot promise a position the drop does not
  // deliver — a line drawn above whatever card the pointer happens to be over
  // would lie every time the card is travelling downwards, because taking a
  // lower card's slot puts you AFTER it.
  dropIndicator: {
    height: '2px',
    margin: '-3px 0',
    borderRadius: '1px',
    background: 'var(--v2-accent)',
    flexShrink: 0,
  },
  // Non-blocking failure surface for a refused move. Deliberately NOT an
  // alert(): a drag that lost a race is the most ordinary failure on this
  // screen (another tab moved the same card), and stopping the tab dead to say
  // so would be wildly out of proportion. The card is already back where it
  // was by the time this appears — the hook rolled it back — so this only
  // explains what the user just watched happen.
  moveErrorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    background: 'var(--v2-surface-3)',
    borderBottom: '1px solid var(--v2-border)',
    color: 'var(--v2-danger)',
    fontSize: '12px',
    flexShrink: 0,
  },
  moveErrorDismiss: {
    marginLeft: 'auto',
    flexShrink: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '14px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  // The card that follows the pointer. Same shape as a real card, raised with
  // the existing shadow token so it reads as lifted off the board — the same
  // mechanism and the same vocabulary as the dragged column's overlay.
  dragOverlayCard: {
    width: '280px',
    background: 'var(--v2-surface-2)',
    border: '1px solid var(--v2-accent)',
    borderRadius: '10px',
    padding: '10px 12px',
    boxShadow: 'var(--v2-shadow-lg)',
    color: 'var(--v2-text)',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1.35,
    cursor: 'grabbing',
  },
  card: {
    background: 'var(--v2-surface-2)',
    border: '1px solid var(--v2-border)',
    borderRadius: '10px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  // Reaproveitado por um <button> (título clicável, abre o CardFormModal em
  // modo 'edit') em vez do <div> original — os resets abaixo (border/
  // background/padding/margin/textAlign/font/width) fazem o botão se
  // comportar visualmente como o texto que era antes, sem herdar o chrome
  // padrão de <button> do browser.
  cardTitle: {
    display: 'block',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    textAlign: 'left',
    font: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    lineHeight: 1.35,
  },
  cardDesc: {
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
  },
  avatar: {
    width: '22px',
    height: '22px',
    minWidth: '22px',
    borderRadius: '50%',
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    fontSize: '10px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tag: {
    fontSize: '10px',
    color: 'var(--v2-text-faint)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  statusSelect: {
    fontSize: '11px',
    color: 'var(--v2-text-dim)',
    background: 'var(--v2-surface-3)',
    border: '1px solid var(--v2-border)',
    borderRadius: '6px',
    padding: '3px 4px',
    flexShrink: 0,
  },
  addBtn: {
    margin: '2px 10px 10px',
    padding: '10px',
    borderRadius: '8px',
    border: '1px dashed var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '12px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  // Meta row at the top of the card face: copyable id + client on the left,
  // tipo chip on the right. A card with no tipo gets no placeholder — the row
  // just shrinks.
  cardMetaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    minWidth: 0,
  },
  tipoChip: (tipo) => ({
    padding: '2px 7px',
    borderRadius: '5px',
    background: CARD_TIPO_COLORS[tipo].soft,
    color: CARD_TIPO_COLORS[tipo].strong,
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '.06em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  prazo: (atrasado) => ({
    fontSize: '10px',
    fontWeight: atrasado ? 700 : 400,
    color: atrasado ? 'var(--v2-danger)' : 'var(--v2-text-faint)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
};

// Iniciais do responsável pelo card, a partir de `ultima_atualizacao_por`
// ("bruno" ou "agente:{agent_id}") — reduzida aqui a um avatar de 2 letras em
// vez de um badge com o texto completo.
function resolveAvatarInitials(ultimaAtualizacaoPor) {
  if (!ultimaAtualizacaoPor || ultimaAtualizacaoPor === 'bruno') return 'BR';
  const agentId = ultimaAtualizacaoPor.startsWith('agente:')
    ? ultimaAtualizacaoPor.slice('agente:'.length)
    : ultimaAtualizacaoPor;
  return (agentId || '?').slice(0, 2).toUpperCase();
}

export function BoardV2({ projects = [], selectedClienteId = null }) {
  // Cliente -> Projeto cascade (local state of this screen). `selectedProjectIds`
  // (plural) is the LISTING filter; `selectedProjetoId` (singular) is the
  // chosen Tier 2, which also becomes the create modal's default project.
  const {
    clienteSelectEnabled,
    clientes,
    effectiveClienteId,
    localClienteId,
    setLocalClienteId,
    subProjetoIds,
    selectedProjetoId,
    setSelectedProjetoId,
    selectedProjectIds,
  } = useClienteProjetoFilter(projects, selectedClienteId);

  // Órfãos (decisão do Bruno, sessão "card/tarefa órfão"): com um cliente
  // fixo e o Tier 2 em "Todos os projetos", `selectedProjectIds` só lista nós
  // REAIS presentes em `projects` (collectSubtreeIds, useClienteProjetoFilter.js)
  // — uma query de servidor escopada a essa lista nunca poderia trazer um
  // card de projeto órfão (removido/desconhecido do disco), diferente de
  // TarefasV2.jsx (que já busca tudo via useGlobalTasks e filtra client-side).
  // Pra igualar o comportamento: com Tier 2 em "Todos os projetos", busca
  // TUDO (`useCards([])`, mesmo mecanismo "sem filtro" documentado no
  // cabeçalho de useCards.js) e filtra a EXIBIÇÃO client-side por prefixo de
  // cliente — mesma função (`clienteIdFromProjetoId`) que TarefasV2/
  // useClienteProjetoFilter.js já usam. Só quando o Tier 2 já escolheu um
  // projeto específico a query volta a ser escopada (`selectedProjectIds`):
  // um projeto órfão nunca aparece nesse dropdown pra ser escolhido, então
  // esse caso já é consistente com TarefasV2 (que também só derruba a órfã
  // quando o Tier 2 escolhe um projeto específico).
  const fetchProjectIds = effectiveClienteId != null && selectedProjetoId == null
    ? []
    : selectedProjectIds;

  // Columns are GLOBAL — no project filter — so this hook takes no argument
  // and does no polling (see useColumns.js). `doneSlug` is threaded into
  // useCards so that every local recomputation of "done" agrees with the
  // board instead of hard-coding 'feito'.
  const {
    columns,
    loading: columnsLoading,
    doneSlug,
    firstSlug,
    createColumn,
    renameColumn,
    reorderColumns,
    setDoneColumn,
    deleteColumn,
  } = useColumns();

  const {
    cards: fetchedCards,
    createCard,
    updateCard,
    moveCard,
    setCardDragActive,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  } = useCards(fetchProjectIds, doneSlug);

  // Filtro de exibição client-side, sempre que um cliente está fixo — no
  // ramo "Tier 2 em Todos" acima ele é o que de fato restringe a tela a este
  // cliente (a busca trouxe tudo); no ramo "Tier 2 escopado" ele é redundante
  // com a query (todo card já pertence ao cliente), mas inofensivo. Também
  // filtra fora, de propósito, um card recém-criado via append otimista
  // (useCards.js) que não pertença ao cliente atual — o append otimista em
  // si não sabe filtrar por cliente.
  const cards = effectiveClienteId != null
    ? fetchedCards.filter((c) => clienteIdFromProjetoId(c.projeto_id) === effectiveClienteId)
    : fetchedCards;

  // Status of the column whose "+ Adicionar card" was clicked (null = create
  // modal closed). Holds the STATUS, not a boolean: it is the modal's
  // `defaultStatus`, and it is what makes the card land in the right column.
  //
  // ⚠️ The modal is mounted CONDITIONALLY (see the JSX at the end of the file),
  // both here and in edit mode. `CardFormModal` runs `if (!open) return null`
  // AFTER the `useState` calls, and the initialisers are lazy: keeping it
  // mounted with `open={false}` would freeze the create defaults
  // (client/project from the filter) at the first render — open, close, switch
  // client in the filter, reopen, and the old client comes back.
  const [creatingStatus, setCreatingStatus] = useState(null);

  // Id do card sendo editado no CardFormModal (Fase 4), ou `null` = modal
  // fechado. Guarda só o id, NÃO um snapshot do card: um snapshot não se
  // atualiza sozinho enquanto o modal está aberto, e este board não tem tira
  // de imagem no rosto do card (ver comentário "NÃO implementado" acima) — o
  // modal é a ÚNICA superfície de imagem aqui, então ele precisa refletir
  // `uploadCardImage`/`deleteCardImage` (mutações de `useCards`, que
  // atualizam `cards`) em tempo real, ou pareceria travado ao enviar uma
  // imagem. Derivar de `cards` a cada render resolve isso;
  // `CardFormModal` usa `useState` com
  // inicializador preguiçoso para título/descrição/status, então uma
  // mudança na referência de `card` entre renders não reseta o que o Bruno
  // já estiver digitando.
  const [editingCardId, setEditingCardId] = useState(null);
  const editingCard = editingCardId != null ? cards.find((c) => c.id === editingCardId) : null;

  // "Limpar concluídos" — ported from the v1 board, the only surface this
  // action used to have. The endpoint deletes by ONE `projeto_id` at a time,
  // so the target is the most specific tier the filter currently holds: the
  // Tier 2 project if one is picked, else the active client. With
  // neither (sidebar and local select both on "Todos") there is nothing to
  // address — the button is disabled and says why, exactly as v1 did.
  //
  // The enable rule is the TIER ALONE, deliberately narrower than v1's
  // `mostSpecificProjectId != null && projectHasFinished(...)`: with no card
  // done yet, ClearFinishedModal already resolves its preview to the 'empty'
  // phase and says "Nenhum card concluído neste projeto ainda". Gating on a
  // local card count would also make the button lie whenever the board is
  // showing a filtered subset of what the target project actually holds.
  const clearTargetId = selectedProjetoId ?? effectiveClienteId;
  const clearEnabled = clearTargetId != null;
  const [clearFinishedOpen, setClearFinishedOpen] = useState(false);

  // The target (`projeto_id` OR `cliente_id`) comes from the modal's payload
  // now, not from a prop: the modal owns the Cliente/Projeto choice.
  const handleCreateSubmit = (payload) => createCard(payload);

  const handleMove = (cardId, status) => updateCard(cardId, { status });

  // -- column management state ---------------------------------------------
  //
  // All of it is local and transient: which column's title is being edited,
  // which "⋯" menu is open, whether the ghost column has turned into an
  // input, and which column just moved (for the border flash). None of it
  // belongs in useColumns, which owns the persisted list only.
  // { slug, label } of the column being renamed, or null. Renaming is a modal
  // now, not an inline input on the title: the whole header became the drag
  // surface, and click-to-edit could not share those pixels with
  // click-and-drag.
  const [renameTarget, setRenameTarget] = useState(null);
  const [renamingColumn, setRenamingColumn] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [openMenuSlug, setOpenMenuSlug] = useState(null);
  const [creatingColumn, setCreatingColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [flashedSlug, setFlashedSlug] = useState(null);
  // { slug, label, reason, cards } — `reason: 'confirm'` is the real
  // confirmation; the others are the backend's refusal codes.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingColumn, setDeletingColumn] = useState(false);

  const openRenameDialog = (column) => {
    setRenameTarget({ slug: column.slug, label: column.label });
    setRenameError(null);
  };

  // The rejection message is shown INSIDE the dialog and the dialog stays
  // open, holding what the user typed. The old inline input reverted silently
  // on a duplicate name, which left them retyping the same thing with no idea
  // why it kept snapping back.
  const handleConfirmRename = async (label) => {
    if (!renameTarget) return;
    // Renaming to the current name is a no-op, not a request.
    if (label === renameTarget.label) {
      setRenameTarget(null);
      return;
    }
    setRenamingColumn(true);
    setRenameError(null);
    try {
      await renameColumn(renameTarget.slug, label);
      setRenameTarget(null);
    } catch (e) {
      setRenameError(e.message || 'Falha ao renomear a coluna.');
    } finally {
      setRenamingColumn(false);
    }
  };

  const commitNewColumn = async () => {
    const label = newColumnLabel.trim();
    setCreatingColumn(false);
    setNewColumnLabel('');
    if (!label) return;
    try {
      await createColumn(label);
    } catch (e) {
      alert(e.message || 'Falha ao criar a coluna.');
    }
  };

  // -- drag to reorder (phase 2) -------------------------------------------
  //
  // Drag is the ONLY way to reorder a column. The ◀▶ arrows that shipped in
  // phase 1 are gone at Bruno's request, and he accepted the trade knowingly:
  // they were the only keyboard-reachable path, and this build registers no
  // KeyboardSensor, so until someone adds one there is no keyboard route to
  // reordering. Deliberate, documented, and out of scope to fix here.
  const [draggingSlug, setDraggingSlug] = useState(null);
  const draggingColumn = draggingSlug
    ? columns.find((c) => c.slug === draggingSlug)
    : null;

  const columnSlugs = useMemo(() => columns.map((c) => c.slug), [columns]);

  // -- drag a card to reposition it (phase 3) ------------------------------
  //
  // Same DndContext, same sensors, same overlay mechanism as the column drag
  // above — only the id namespace and the drop handler differ.
  const [draggingCardId, setDraggingCardId] = useState(null);
  const draggingCard = draggingCardId != null
    ? cards.find((c) => c.id === draggingCardId)
    : null;
  // { status, beforeId } — where the indicator line is drawn right now.
  // `beforeId` null means "at the end of that column". Computed from the very
  // same helper the drop uses, so the line never promises a slot the drop
  // would not produce.
  const [dropHint, setDropHint] = useState(null);
  // Message from a refused move, shown in the banner. Never an alert(): see
  // `styles.moveErrorBar`.
  const [moveError, setMoveError] = useState(null);

  // Cards of one column, in render order — the SAME list the user is looking
  // at, which is what the anchors have to be computed from. It is the
  // client-filtered `cards`, so a card hidden by the client filter is not an
  // anchor candidate; the backend does not require adjacency, so the moved
  // card still lands between the two visible ones the user aimed at.
  const cardsInColumn = useCallback(
    (status) => cards.filter((c) => c.status === status),
    [cards]
  );

  const boardDndAccessibility = useMemo(() => {
    const labelBySlug = new Map(columns.map((c) => [c.slug, c.label]));
    const tituloById = new Map(cards.map((c) => [c.id, c.titulo]));
    const describe = (id) => {
      if (isCardDndId(id)) {
        const cardId = cardIdFromDndId(id);
        return `Card ${tituloById.get(cardId) ?? cardId}`;
      }
      if (isColumnDropzoneId(id)) {
        const slug = slugFromColumnDropzoneId(id);
        return `o fim da coluna ${labelBySlug.get(slug) ?? slug}`;
      }
      return `Coluna ${labelBySlug.get(id) ?? id}`;
    };
    return {
      screenReaderInstructions: BOARD_DND_SCREEN_READER_INSTRUCTIONS,
      announcements: buildBoardDndAnnouncements(describe),
    };
  }, [columns, cards]);

  // ONE sensor list for both kinds of drag — the plan's instruction, and the
  // right call anyway: a card and a column should arm on the same gesture, and
  // two sensor sets in one DndContext is not even expressible.
  const boardDragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: BOARD_DRAG_POINTER_DISTANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: BOARD_DRAG_LONG_PRESS_MS,
        tolerance: BOARD_DRAG_TOLERANCE_PX,
      },
    })
  );

  // Resolve dnd-kit's `over` to the destination column plus the card that was
  // dropped on (null = the column's empty area). Returns null when the card
  // was released somewhere that is not a valid destination at all — released
  // outside the board, or over a column that has since disappeared — which the
  // caller turns into a cancelled drag with no request.
  const resolveCardDropTarget = (overId) => {
    if (overId == null) return null;
    if (isColumnDropzoneId(overId)) {
      const slug = slugFromColumnDropzoneId(overId);
      if (!columns.some((c) => c.slug === slug)) return null;
      return { status: slug, overCardId: null };
    }
    if (isCardDndId(overId)) {
      const overCardId = cardIdFromDndId(overId);
      const overCard = cards.find((c) => c.id === overCardId);
      if (!overCard) return null;
      return { status: overCard.status, overCardId };
    }
    // A bare column slug. The collision detection filters columns out of a
    // card drag, so this is unreachable in practice — and cancelling is the
    // right answer if it ever stops being: a column's own sortable rect is the
    // whole column, which says nothing about WHERE in it the card should land.
    return null;
  };

  const handleCardDragStart = (event) => {
    setDraggingCardId(cardIdFromDndId(event.active.id));
    setDropHint(null);
    // Suspends the 5s poll for as long as the finger is down. Without it a
    // tick landing mid-drag replaces the array the sortable preview is
    // animating, and the cards jump out from under the pointer.
    setCardDragActive(true);
  };

  const handleCardDragOver = (event) => {
    const activeCardId = cardIdFromDndId(event.active.id);
    const target = resolveCardDropTarget(event.over?.id);
    if (activeCardId == null || target == null) {
      setDropHint(null);
      return;
    }
    const columnIds = cardsInColumn(target.status).map((c) => c.id);
    const drop = computeCardDrop(columnIds, activeCardId, target.overCardId);
    // No indicator for a no-op: there is nothing to promise.
    setDropHint(drop ? { status: target.status, beforeId: drop.before_id } : null);
  };

  const finishCardDrag = () => {
    setDraggingCardId(null);
    setDropHint(null);
    setCardDragActive(false);
  };

  const handleCardDragEnd = async (event) => {
    const activeCardId = cardIdFromDndId(event.active.id);
    const target = resolveCardDropTarget(event.over?.id);
    finishCardDrag();
    // Released outside any valid column: cancelled, with no request at all.
    if (activeCardId == null || target == null) return;

    const columnIds = cardsInColumn(target.status).map((c) => c.id);
    const drop = computeCardDrop(columnIds, activeCardId, target.overCardId);
    // `null` is the no-op case — dropped back into its own slot. Same identity
    // shortcut `reorderColumns` gives the column drag: no optimistic update,
    // no round-trip.
    if (drop === null) return;

    setMoveError(null);
    try {
      // Optimistic with rollback inside useCards, like reorderColumns inside
      // useColumns — the state that has to move instantly lives in the hook
      // that owns it, not here.
      await moveCard(activeCardId, {
        status: target.status,
        after_id: drop.after_id,
        before_id: drop.before_id,
      });
    } catch (e) {
      // The hook already put the card back. This only explains it, and it does
      // so WITHOUT blocking the tab — a 409 here means another tab moved the
      // same neighbourhood, and the honest instruction is "look and try
      // again", which an alert() would prevent them from doing.
      setMoveError(e.conflict
        ? `${e.message} O card voltou para onde estava — confira o board e tente de novo.`
        : (e.message || 'Falha ao mover o card.'));
    }
  };

  const handleColumnDragStart = (event) => setDraggingSlug(event.active.id);
  const handleColumnDragCancel = () => setDraggingSlug(null);

  const handleColumnDragEnd = async (event) => {
    setDraggingSlug(null);
    const { active, over } = event;
    const current = columns.map((c) => c.slug);
    // `over` is null when the column was released outside every droppable.
    const next = reorderSlugs(current, active?.id, over?.id);
    // Identity, not deep comparison: the pure helper returns the array it was
    // handed when the drag changed nothing, so a cancelled or same-slot drop
    // costs no optimistic update and no request.
    if (next === current) return;

    try {
      // Optimistic locally, with rollback, inside useColumns — the same path
      // the arrows use, so drag and arrows can never drift apart.
      await reorderColumns(next);
      setFlashedSlug(null);
      requestAnimationFrame(() => setFlashedSlug(active.id));
    } catch (e) {
      // The hook already restored the previous order; this only explains it.
      // No automatic retry/refetch in this phase (deliberately out of scope) —
      // the board is back where it was and the arrows still work.
      alert(e.message || 'Falha ao reordenar as colunas.');
    }
  };

  // One handler per dnd-kit callback, dispatching on the id NAMESPACE. Written
  // as an explicit branch rather than letting the column path treat a card id
  // as a harmless no-op: that would be true only by accident (`indexOf`
  // returning -1), which is not a property worth depending on — and it would
  // silently swallow a card drop the moment the namespaces changed.
  const handleDragStart = (event) => (
    isCardDndId(event.active.id)
      ? handleCardDragStart(event)
      : handleColumnDragStart(event)
  );

  // Only the card drag has anything to do here: the drop indicator has to be
  // recomputed as the pointer travels. A column drag needs no `onDragOver` —
  // its feedback is the columns shifting, which dnd-kit animates on its own.
  const handleDragOver = (event) => {
    if (isCardDndId(event.active.id)) handleCardDragOver(event);
  };

  const handleDragEnd = (event) => (
    isCardDndId(event.active.id)
      ? handleCardDragEnd(event)
      : handleColumnDragEnd(event)
  );

  const handleDragCancel = (event) => (
    isCardDndId(event?.active?.id) ? finishCardDrag() : handleColumnDragCancel()
  );

  const handleMarkDone = async (slug) => {
    try {
      await setDoneColumn(slug);
    } catch (e) {
      alert(e.message || 'Falha ao marcar a coluna como concluída.');
    }
  };

  // The dialog is opened OPTIMISTICALLY as a real confirmation and only
  // downgraded to one of the informational variants if the backend refuses:
  // the frontend cannot count a column's cards on its own (the board may be
  // showing a filtered subset, and subcards count too), so the server's
  // answer is the only trustworthy one.
  const handleConfirmDeleteColumn = async () => {
    if (!deleteTarget) return;
    setDeletingColumn(true);
    try {
      await deleteColumn(deleteTarget.slug);
      setDeleteTarget(null);
    } catch (e) {
      if (e.reason) {
        setDeleteTarget({ ...deleteTarget, reason: e.reason, cards: e.cards || 0 });
      } else {
        alert(e.message || 'Falha ao excluir a coluna.');
        setDeleteTarget(null);
      }
    } finally {
      setDeletingColumn(false);
    }
  };

  const handleEditSubmit = (payload) => updateCard(editingCardId, payload);

  const handleEditDelete = async (cardId) => {
    await deleteCard(cardId);
    setEditingCardId(null);
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <ClienteProjetoFilterBar
          clienteSelectEnabled={clienteSelectEnabled}
          clientes={clientes}
          localClienteId={localClienteId}
          onSelectLocalCliente={setLocalClienteId}
          effectiveClienteId={effectiveClienteId}
          subProjetoIds={subProjetoIds}
          selectedProjetoId={selectedProjetoId}
          onSelectProjeto={setSelectedProjetoId}
          projects={projects}
        />
        <div style={styles.headerActions}>
          <button
            type="button"
            disabled={!clearEnabled}
            style={styles.clearBtn(!clearEnabled)}
            title={clearEnabled ? undefined : 'Selecione um cliente ou projeto para limpar concluídos'}
            onClick={() => setClearFinishedOpen(true)}
          >
            Limpar concluídos
          </button>
        </div>
      </div>
      {/* A refused move explains itself here, not in an alert(). `role="alert"`
          so it is announced without stealing focus — the user may well be
          mid-gesture on something else. */}
      {moveError && (
        <div style={styles.moveErrorBar} role="alert" data-testid="board-v2-move-error">
          <span>{moveError}</span>
          <button
            type="button"
            style={styles.moveErrorDismiss}
            aria-label="Fechar aviso"
            onClick={() => setMoveError(null)}
          >
            ✕
          </button>
        </div>
      )}
      <style>{COLUMN_FLASH_CSS}</style>
      {/* The scroller waits for the columns. Rendering it during `loading`
          would paint a board with zero columns and a `doneSlug` of null for
          one frame — every card would flash as "not done" and the ghost
          column would sit alone on an empty board. */}
      {!columnsLoading && (
      <DndContext
        accessibility={boardDndAccessibility}
        sensors={boardDragSensors}
        collisionDetection={buildBoardCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <SortableContext items={columnSlugs} strategy={horizontalListSortingStrategy}>
      <div style={styles.scroller}>
        {columns.map((column) => {
          const status = column.slug;
          const columnCards = cards.filter((c) => c.status === status);
          return (
            <SortableBoardColumn key={status} slug={status} label={column.label}>
            {({ headerDragProps, bodyDropProps }) => (
            <div
              style={styles.column(column.is_done)}
              className={flashedSlug === status ? 'v2-column-flash' : undefined}
              data-testid={`board-v2-col-${status}`}
            >
              {/* The WHOLE header bar is the drag surface (Bruno's call after
                  testing phase 2 live — grab anywhere, like Jira). The "⋯"
                  button inside keeps working: the sensors only arm after 6px
                  of travel (mouse) or a 280ms hold (touch), so a plain click
                  never crosses the threshold and its native `click` fires.

                  `role="group"` is load-bearing, not decoration. ARIA 1.2
                  forbids naming a generic element, so on a roleless <div> the
                  `aria-label` below would be DROPPED — the same role-gating
                  that made dnd-kit's own `aria-roledescription` inert here.
                  `group` is the right one: it names the bar without putting it
                  in the tab order and without impersonating a button while
                  containing one. */}
              <div
                {...headerDragProps}
                role="group"
                style={{ ...styles.columnHeader, ...headerDragProps.style }}
                data-testid={`board-v2-col-header-${status}`}
              >
                {/* Plain text: clicking the title used to open an inline
                    rename, which moved to the "⋯" menu when the header became
                    the drag surface. */}
                <span style={styles.columnTitle}>{column.label}</span>

                {column.is_done && (
                  <span style={styles.doneBadge} aria-label="Coluna concluída">✓</span>
                )}
                <span style={styles.columnCount}>({columnCards.length})</span>

                <BoardColumnMenu
                  columnLabel={column.label}
                  isDone={column.is_done}
                  isLastColumn={columns.length === 1}
                  open={openMenuSlug === status}
                  onToggle={(next) => setOpenMenuSlug(next ? status : null)}
                  onRequestRename={() => openRenameDialog(column)}
                  onMarkDone={() => handleMarkDone(status)}
                  onRequestDelete={() => setDeleteTarget({
                    slug: status, label: column.label, reason: 'confirm', cards: 0,
                  })}
                />
              </div>

              {/* The card list is its own VERTICAL SortableContext, nested
                  inside the board-wide horizontal one. Nesting is what lets a
                  card and a column be dragged in the same DndContext: each
                  context only knows about its own `items`, and the id
                  namespaces (`card:` vs bare slug) keep the drop handler from
                  ever confusing the two.

                  The body is also the column's card DROPZONE
                  (`bodyDropProps.ref`) — an empty column has no sortable item
                  to collide with, so without it the first card could never be
                  dropped into a new column. */}
              <SortableContext
                items={columnCards.map((c) => cardDndId(c.id))}
                strategy={verticalListSortingStrategy}
              >
              <div
                ref={bodyDropProps.ref}
                style={styles.columnBody(bodyDropProps.isCardOver && !columnCards.length)}
                data-testid={`board-v2-col-body-${status}`}
              >
                {columnCards.map((card) => {
                  // Tag de cliente sempre presente; a de projeto só quando o
                  // projeto é de fato diferente do cliente (um
                  // cliente-como-projeto repetiria o mesmo nome duas vezes).
                  const { clienteNome, projetoNome } = resolveCardTags(card.projeto_id, projects);
                  const atrasado = isPrazoAtrasado(card.prazo, card.status, doneSlug);
                  const showIndicatorAbove = dropHint != null
                    && dropHint.status === status
                    && dropHint.beforeId === card.id;
                  return (
                    <SortableBoardCard key={card.id} cardId={card.id} titulo={card.titulo}>
                    {({ dragProps }) => (
                    <>
                    {/* Drawn ABOVE the card the moved one will sit before —
                        which is the slot `computeCardDrop` actually reported,
                        not merely the card the pointer is over. */}
                    {showIndicatorAbove && (
                      <div
                        style={styles.dropIndicator}
                        data-testid="board-v2-drop-indicator"
                        aria-hidden="true"
                      />
                    )}
                    <div
                      {...dragProps}
                      role="group"
                      style={{ ...styles.card, ...dragProps.style }}
                      data-testid={`board-v2-card-${card.id}`}
                    >
                      <div style={styles.cardMetaRow}>
                        <CardIdBadge id={card.id} clienteNome={clienteNome} variant="card" />
                        {card.tipo && CARD_TIPO_COLORS[card.tipo] && (
                          <span style={styles.tipoChip(card.tipo)}>{CARD_TIPO_LABELS[card.tipo]}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        style={styles.cardTitle}
                        onClick={() => setEditingCardId(card.id)}
                      >
                        {card.titulo}
                      </button>
                      {card.descricao && <div style={styles.cardDesc}>{card.descricao}</div>}
                      <div style={styles.cardFooter}>
                        <div style={styles.cardMeta}>
                          <span style={styles.avatar} title={card.ultima_atualizacao_por || 'bruno'}>
                            {resolveAvatarInitials(card.ultima_atualizacao_por)}
                          </span>
                          {/* The client tag moved out of here: it now lives in
                              the meta row, next to the id. Only the project tag
                              stays, and only when the project differs from the
                              client. */}
                          {projetoNome && (
                            <span data-testid="card-tag" style={styles.tag}>{projetoNome}</span>
                          )}
                          {card.prazo && (
                            <span style={styles.prazo(atrasado)}>{formatPrazo(card.prazo)}</span>
                          )}
                        </div>
                        <select
                          style={styles.statusSelect}
                          value={card.status}
                          aria-label={`Mover "${card.titulo}"`}
                          onChange={(e) => handleMove(card.id, e.target.value)}
                        >
                          {columns.map((c) => (
                            <option key={c.slug} value={c.slug}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    </>
                    )}
                    </SortableBoardCard>
                  );
                })}
                {/* The end-of-column slot. `beforeId === null` is what
                    `computeCardDrop` reports for a drop past the last card, so
                    the line belongs after the list, not above any card. */}
                {dropHint != null && dropHint.status === status
                  && dropHint.beforeId == null && (
                  <div
                    style={styles.dropIndicator}
                    data-testid="board-v2-drop-indicator"
                    aria-hidden="true"
                  />
                )}
              </div>
              </SortableContext>

              {/* Always visible: the old "Selecione um projeto na barra
                  lateral" blocker is gone along with the `selectedProjectId`
                  prop. The card's Cliente/Projeto is chosen inside the modal. */}
              <button type="button" style={styles.addBtn} onClick={() => setCreatingStatus(status)}>
                + Adicionar card
              </button>
            </div>
            )}
            </SortableBoardColumn>
          );
        })}

        {/* Ghost column — the only way to create a column. It sits at the END
            of the scroller because a new column is always appended there
            (the backend assigns position = max + 1); putting the affordance
            anywhere else would promise a placement it cannot deliver. */}
        {creatingColumn ? (
          <input
            style={styles.ghostInput}
            value={newColumnLabel}
            autoFocus
            aria-label="Nome da nova coluna"
            placeholder="Nome"
            onChange={(e) => setNewColumnLabel(e.target.value)}
            onBlur={commitNewColumn}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                // Clear BEFORE unmounting the input: blur fires on unmount in
                // some browsers, and a stale draft would create the column
                // the user just cancelled.
                setNewColumnLabel('');
                setCreatingColumn(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            style={styles.ghostColumn}
            onClick={() => setCreatingColumn(true)}
          >
            + Nova coluna
          </button>
        )}
      </div>
      </SortableContext>

      {/* Portaled to document.body. The columns are SIBLINGS of the fixed
          CardFormModal, not ancestors, so a transform on one could not break
          the fixed-positioning invariant either way — but the overlay is the
          library's recommended shape and takes the moving element out of the
          scroller entirely, so it is never clipped by `overflow: auto`. */}
      {createPortal(
        <DragOverlay>
          {draggingCard ? (
            <div style={styles.dragOverlayCard} data-testid="board-v2-card-drag-overlay">
              {draggingCard.titulo}
            </div>
          ) : draggingColumn ? (
            <div
              style={styles.dragOverlayColumn(draggingColumn.is_done)}
              data-testid="board-v2-drag-overlay"
            >
              <div style={styles.columnHeader}>
                <span style={styles.columnTitle}>{draggingColumn.label}</span>
                {draggingColumn.is_done && (
                  <span style={styles.doneBadge} aria-hidden="true">✓</span>
                )}
                <span style={styles.columnCount}>
                  ({cards.filter((c) => c.status === draggingColumn.slug).length})
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
      </DndContext>
      )}

      {/* `defaultStatus`: the clicked column wins; `firstSlug` is the fallback
          for the product rule "a new card is born in the first column of the
          order", which only applies if the click somehow arrives without a
          column of its own. */}
      {creatingStatus && (
        <CardFormModal
          open
          mode="create"
          columns={columns}
          doneSlug={doneSlug}
          projetos={projects}
          defaultClienteId={effectiveClienteId}
          defaultProjetoId={selectedProjetoId}
          defaultStatus={creatingStatus || firstSlug}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingStatus(null)}
        />
      )}

      {renameTarget && (
        <BoardColumnRenameDialog
          open
          columnLabel={renameTarget.label}
          saving={renamingColumn}
          error={renameError}
          onConfirm={handleConfirmRename}
          onClose={() => { setRenameTarget(null); setRenameError(null); }}
        />
      )}

      {deleteTarget && (
        <BoardColumnDeleteDialog
          open
          columnLabel={deleteTarget.label}
          reason={deleteTarget.reason}
          cards={deleteTarget.cards}
          deleting={deletingColumn}
          onConfirm={handleConfirmDeleteColumn}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {editingCard && (
        <CardFormModal
          open
          mode="edit"
          card={editingCard}
          columns={columns}
          doneSlug={doneSlug}
          projetos={projects}
          onSubmit={handleEditSubmit}
          onDelete={handleEditDelete}
          onClose={() => setEditingCardId(null)}
          onUploadImage={(file) => uploadCardImage(editingCardId, file)}
          onDeleteImage={(imageId) => deleteCardImage(editingCardId, imageId)}
        />
      )}

      {/* `clearTargetId` is re-checked here, not just on the button: the
          filter can drop back to "Todos" (sidebar change, client reset) while
          the sheet is open, and the modal dereferences `projetoId` on every
          preview. Falling back to the raw id for the name matters in a
          DESTRUCTIVE confirmation — `resolveProjectName` returns `null` for an
          id the project list cannot resolve, which would render the sheet
          title as the literal "null". */}
      {clearFinishedOpen && clearTargetId != null && (
        <ClearFinishedModal
          open
          projetoId={clearTargetId}
          projetoNome={resolveProjectName(clearTargetId, projects) || clearTargetId}
          onPreview={previewClearFinished}
          onExecute={clearFinished}
          onClose={() => setClearFinishedOpen(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
