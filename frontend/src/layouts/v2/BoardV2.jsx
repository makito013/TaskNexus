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
// scroller), renomear (clique no título), reordenar (setas ◀▶), marcar como
// concluída e excluir (menu "⋯") acontecem todos no header da própria coluna.
// Arrastar coluna e arrastar card ficam para as fases 2 e 3.
import { useRef, useState } from 'react';
import { BoardColumnDeleteDialog } from '../../components/board/BoardColumnDeleteDialog.jsx';
import { BoardColumnMenu } from '../../components/board/BoardColumnMenu.jsx';
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
  // A <button> reset to look like the plain text it replaced — same trick as
  // `cardTitle` below. Clicking it turns the title into an inline input.
  columnTitle: {
    flex: 1,
    minWidth: 0,
    display: 'block',
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
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  columnTitleInput: {
    flex: 1,
    minWidth: 0,
    padding: '2px 6px',
    borderRadius: '6px',
    border: '1px solid var(--v2-accent)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    font: 'inherit',
    fontSize: '13px',
    fontWeight: 600,
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
  // Always visible, never hidden-until-hover: on a touch screen there is no
  // hover to reveal them. Disabled state is a COLOUR change, never `opacity` —
  // a faded arrow on this surface reads as a rendering glitch rather than as
  // "you are already at the end".
  arrowBtn: (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    minWidth: '28px',
    padding: 0,
    borderRadius: '6px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-3)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-text-dim)',
    fontSize: '11px',
    lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    flexShrink: 0,
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
  columnBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
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
  const [editingColumnSlug, setEditingColumnSlug] = useState(null);
  const [columnDraftLabel, setColumnDraftLabel] = useState('');
  const [openMenuSlug, setOpenMenuSlug] = useState(null);
  const [creatingColumn, setCreatingColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [flashedSlug, setFlashedSlug] = useState(null);
  // { slug, label, reason, cards } — `reason: 'confirm'` is the real
  // confirmation; the others are the backend's refusal codes.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingColumn, setDeletingColumn] = useState(false);

  // Escape unmounts the inline input, and React fires `blur` on unmount in
  // some paths — which would commit the very draft the user just cancelled.
  // A ref, not state: `commitColumnLabel` closes over the render's state, so a
  // setState in the Escape handler would not be visible to the blur that
  // follows in the same tick.
  const renameCancelledRef = useRef(false);

  const startEditingColumn = (column) => {
    renameCancelledRef.current = false;
    setEditingColumnSlug(column.slug);
    setColumnDraftLabel(column.label);
  };

  const cancelEditingColumn = () => {
    renameCancelledRef.current = true;
    setEditingColumnSlug(null);
  };

  // Enter and blur both commit; Escape reverts. An unchanged or empty draft
  // is a silent no-op rather than a failed request — retyping the same name
  // is not an error worth an alert.
  const commitColumnLabel = async (column) => {
    if (renameCancelledRef.current) return;
    const label = columnDraftLabel.trim();
    setEditingColumnSlug(null);
    if (!label || label === column.label) return;
    try {
      await renameColumn(column.slug, label);
    } catch (e) {
      alert(e.message || 'Falha ao renomear a coluna.');
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

  // The endpoint takes the WHOLE new order, not a pair of neighbours, so the
  // swap is computed here and the full list is sent.
  const handleMoveColumn = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const slugs = columns.map((c) => c.slug);
    [slugs[index], slugs[target]] = [slugs[target], slugs[index]];
    const movedSlug = slugs[target];
    try {
      await reorderColumns(slugs);
      // Re-arming the flash needs the class to actually leave the DOM first,
      // otherwise moving the same column twice in a row replays nothing.
      setFlashedSlug(null);
      requestAnimationFrame(() => setFlashedSlug(movedSlug));
    } catch (e) {
      alert(e.message || 'Falha ao reordenar as colunas.');
    }
  };

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
      <style>{COLUMN_FLASH_CSS}</style>
      {/* The scroller waits for the columns. Rendering it during `loading`
          would paint a board with zero columns and a `doneSlug` of null for
          one frame — every card would flash as "not done" and the ghost
          column would sit alone on an empty board. */}
      {!columnsLoading && (
      <div style={styles.scroller}>
        {columns.map((column, columnIndex) => {
          const status = column.slug;
          const columnCards = cards.filter((c) => c.status === status);
          const isFirst = columnIndex === 0;
          const isLast = columnIndex === columns.length - 1;
          return (
            <div
              key={status}
              style={styles.column(column.is_done)}
              className={flashedSlug === status ? 'v2-column-flash' : undefined}
              data-testid={`board-v2-col-${status}`}
            >
              <div style={styles.columnHeader}>
                <button
                  type="button"
                  style={styles.arrowBtn(isFirst)}
                  disabled={isFirst}
                  aria-label={`Mover coluna ${column.label} para a esquerda`}
                  onClick={() => handleMoveColumn(columnIndex, -1)}
                >
                  ◀
                </button>

                {editingColumnSlug === status ? (
                  <input
                    style={styles.columnTitleInput}
                    value={columnDraftLabel}
                    autoFocus
                    aria-label={`Renomear coluna ${column.label}`}
                    onChange={(e) => setColumnDraftLabel(e.target.value)}
                    onBlur={() => commitColumnLabel(column)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') cancelEditingColumn();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    style={styles.columnTitle}
                    onClick={() => startEditingColumn(column)}
                  >
                    {column.label}
                  </button>
                )}

                {column.is_done && (
                  <span style={styles.doneBadge} aria-label="Coluna concluída">✓</span>
                )}
                <span style={styles.columnCount}>({columnCards.length})</span>

                <button
                  type="button"
                  style={styles.arrowBtn(isLast)}
                  disabled={isLast}
                  aria-label={`Mover coluna ${column.label} para a direita`}
                  onClick={() => handleMoveColumn(columnIndex, 1)}
                >
                  ▶
                </button>

                <BoardColumnMenu
                  columnLabel={column.label}
                  isDone={column.is_done}
                  isLastColumn={columns.length === 1}
                  open={openMenuSlug === status}
                  onToggle={(next) => setOpenMenuSlug(next ? status : null)}
                  onMarkDone={() => handleMarkDone(status)}
                  onRequestDelete={() => setDeleteTarget({
                    slug: status, label: column.label, reason: 'confirm', cards: 0,
                  })}
                />
              </div>

              <div style={styles.columnBody}>
                {columnCards.map((card) => {
                  // Tag de cliente sempre presente; a de projeto só quando o
                  // projeto é de fato diferente do cliente (um
                  // cliente-como-projeto repetiria o mesmo nome duas vezes).
                  const { clienteNome, projetoNome } = resolveCardTags(card.projeto_id, projects);
                  const atrasado = isPrazoAtrasado(card.prazo, card.status, doneSlug);
                  return (
                    <div key={card.id} style={styles.card} data-testid={`board-v2-card-${card.id}`}>
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
                  );
                })}
              </div>

              {/* Always visible: the old "Selecione um projeto na barra
                  lateral" blocker is gone along with the `selectedProjectId`
                  prop. The card's Cliente/Projeto is chosen inside the modal. */}
              <button type="button" style={styles.addBtn} onClick={() => setCreatingStatus(status)}>
                + Adicionar card
              </button>
            </div>
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
