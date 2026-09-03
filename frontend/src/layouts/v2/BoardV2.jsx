// frontend/src/layouts/v2/BoardV2.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): versão v2 do Board —
// kanban horizontal com scroll-x, uma coluna FIXA de 300px por status (não
// por projeto). Reaproveita `useCards` (frontend/src/hooks/useCards.js) tal
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
import { useState } from 'react';
import { CardFormModal } from '../../components/board/CardFormModal.jsx';
import { CardIdBadge } from '../../components/board/CardIdBadge.jsx';
import { ClearFinishedModal } from '../../components/board/ClearFinishedModal.jsx';
import { useCards } from '../../hooks/useCards.js';
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

const STATUSES = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];
const STATUS_LABELS = {
  a_fazer: 'A Fazer',
  em_andamento: 'Em Andamento',
  em_revisao: 'Em Revisão',
  feito: 'Feito',
};

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
  column: {
    width: '300px',
    minWidth: '300px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    height: '100%',
    overflow: 'hidden',
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    borderBottom: '1px solid var(--v2-border)',
    flexShrink: 0,
  },
  columnTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  columnCount: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
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
  const {
    cards: fetchedCards,
    createCard,
    updateCard,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  } = useCards(fetchProjectIds);

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
      <div style={styles.scroller}>
        {STATUSES.map((status) => {
          const columnCards = cards.filter((c) => c.status === status);
          return (
            <div key={status} style={styles.column} data-testid={`board-v2-col-${status}`}>
              <div style={styles.columnHeader}>
                <span style={styles.columnTitle}>{STATUS_LABELS[status]}</span>
                <span style={styles.columnCount}>({columnCards.length})</span>
              </div>

              <div style={styles.columnBody}>
                {columnCards.map((card) => {
                  // Tag de cliente sempre presente; a de projeto só quando o
                  // projeto é de fato diferente do cliente (um
                  // cliente-como-projeto repetiria o mesmo nome duas vezes).
                  const { clienteNome, projetoNome } = resolveCardTags(card.projeto_id, projects);
                  const atrasado = isPrazoAtrasado(card.prazo, card.status);
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
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
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
      </div>

      {creatingStatus && (
        <CardFormModal
          open
          mode="create"
          projetos={projects}
          defaultClienteId={effectiveClienteId}
          defaultProjetoId={selectedProjetoId}
          defaultStatus={creatingStatus}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreatingStatus(null)}
        />
      )}

      {editingCard && (
        <CardFormModal
          open
          mode="edit"
          card={editingCard}
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
