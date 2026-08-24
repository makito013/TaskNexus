// frontend/src/layouts/v2/BoardV2.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): versão v2 do Board —
// kanban horizontal com scroll-x, uma coluna FIXA de 300px por status (não
// por projeto — diferente de KanbanBoard.jsx v1, que agrupa em swimlanes por
// projeto). Reaproveita `useCards` (frontend/src/hooks/useCards.js) tal como
// está: mesmo hook, mesmas ações (createCard, updateCard) que
// views/BoardView.jsx (v1) já usa — só a apresentação muda, conforme
// instrução do Designer/TL para este milestone.
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
// `selectedProjectId` continua existindo à parte, só para o fluxo de CRIAÇÃO
// de card (`handleCreate` abaixo) — permanece atrelado ao projeto do chat
// ativo de propósito (fora de escopo desta fase desenhar uma UI de "criar
// card cliente-only"), não é contraditório com `selectedClienteId` cuidar da
// listagem: são dois propósitos diferentes que só coincidem quando o chat
// ativo e o cliente da sidebar são o mesmo projeto.
//
// Decisão — "mover card": em vez de reaproveitar `MoveCardMenu.jsx` (v1,
// estilizado com tokens `--*`), o controle de mover é um `<select>` nativo
// simples chamando `updateCard(cardId, { status })` diretamente — mesma ação
// reaproveitada, apresentação nova e mínima (a especificação do Designer
// para este card não pede um menu específico, só que a ação exista).
//
// NÃO implementado nesta tela (ver relatório do Dev): contador de
// subtarefas/tira de imagens inline no rosto do card — a especificação de
// card do Designer para BoardV2 pede apenas título + descrição + avatar +
// tag. Não expandido silenciosamente: é um corte de escopo deliberado, não
// uma lacuna esquecida.
//
// Fase 4 (épico "visualização global de cards presa ao agente aberto"):
// clicar no título do card abre `CardFormModal` (components/board/, mesmo
// componente compartilhado que views/BoardView.jsx v1 já monta) em modo
// 'edit' — reaproveita o fix da Fase 3 (o modal abre a descrição já
// renderizada quando o card já tem uma) e dá a este layout uma forma de
// ver/editar a descrição completa e anexar/remover imagem, sem precisar da
// v1. Continua sem exibir subcards nesta tela (decisão pré-existente acima):
// o modal em modo 'edit' só usa `card.subcards.length` para a contagem do
// aviso de exclusão em cascata, nunca renderiza a lista de subcards em si.
import { useState } from 'react';
import { CardFormModal } from '../../components/board/CardFormModal.jsx';
import { useCards } from '../../hooks/useCards.js';
import { clienteIdFromProjetoId } from '../../utils/clientes.js';
import { ClienteProjetoFilterBar } from './ClienteProjetoFilterBar.jsx';
import { resolveCardTags, useClienteProjetoFilter } from './useClienteProjetoFilter.js';

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
  addForm: {
    margin: '2px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flexShrink: 0,
  },
  addInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '12px',
  },
  addFormActions: {
    display: 'flex',
    gap: '6px',
  },
  addFormBtn: (primary) => ({
    flex: 1,
    padding: '7px',
    borderRadius: '6px',
    border: primary ? 'none' : '1px solid var(--v2-border)',
    background: primary ? 'var(--v2-accent)' : 'transparent',
    color: primary ? 'var(--v2-bg)' : 'var(--v2-text-dim)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
  }),
  hint: {
    padding: '10px 14px',
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
  },
};

// Iniciais do responsável pelo card, a partir de `ultima_atualizacao_por`
// ("bruno" ou "agente:{agent_id}") — mesma fonte de dado que
// CardItem.jsx (v1) usa para o badge de origem, aqui reduzida a um avatar de
// 2 letras em vez de um badge com texto completo.
function resolveAvatarInitials(ultimaAtualizacaoPor) {
  if (!ultimaAtualizacaoPor || ultimaAtualizacaoPor === 'bruno') return 'BR';
  const agentId = ultimaAtualizacaoPor.startsWith('agente:')
    ? ultimaAtualizacaoPor.slice('agente:'.length)
    : ultimaAtualizacaoPor;
  return (agentId || '?').slice(0, 2).toUpperCase();
}

function AddCardForm({ onSubmit, onCancel }) {
  const [titulo, setTitulo] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const trimmed = titulo.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.addForm}>
      <input
        autoFocus
        style={styles.addInput}
        placeholder="Título do card"
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
      />
      <div style={styles.addFormActions}>
        <button type="button" style={styles.addFormBtn(false)} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="button" style={styles.addFormBtn(true)} onClick={handleSubmit} disabled={saving || !titulo.trim()}>
          {saving ? 'Salvando…' : 'Adicionar'}
        </button>
      </div>
    </div>
  );
}

export function BoardV2({ projects = [], selectedProjectId, selectedClienteId = null }) {
  // Cascata Cliente -> Projeto (estado local desta tela). Atenção ao par de
  // nomes parecidos: `selectedProjectIds` (plural) é o filtro de LISTAGEM que
  // sai daqui; `selectedProjectId` (singular, prop) é o projeto do chat ativo
  // e só governa a CRIAÇÃO de card mais abaixo.
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

  // Coluna com o formulário de "+ Adicionar card" aberto (null = nenhuma).
  const [addingStatus, setAddingStatus] = useState(null);

  // Id do card sendo editado no CardFormModal (Fase 4), ou `null` = modal
  // fechado. Guarda só o id, NÃO um snapshot do card — diferente de
  // `formState.card` em views/BoardView.jsx v1 (que guarda o objeto e não se
  // atualiza sozinho enquanto o modal está aberto). Divergência deliberada:
  // em v1 o rosto do card já tem sua própria `ImageAttachments` sempre
  // visível, então uma imagem recém-enviada aparece ali mesmo com o modal
  // "desatualizado". BoardV2 não tem tira de imagem no rosto do card (ver
  // comentário "NÃO implementado" acima) — o modal é a ÚNICA superfície de
  // imagem aqui, então ele precisa refletir `uploadCardImage`/
  // `deleteCardImage` (mutações de `useCards`, que atualizam `cards`) em
  // tempo real, ou pareceria travado ao enviar uma imagem. Derivar de
  // `cards` a cada render resolve isso; `CardFormModal` usa `useState` com
  // inicializador preguiçoso para título/descrição/status, então uma
  // mudança na referência de `card` entre renders não reseta o que o Bruno
  // já estiver digitando.
  const [editingCardId, setEditingCardId] = useState(null);
  const editingCard = editingCardId != null ? cards.find((c) => c.id === editingCardId) : null;

  const handleCreate = async (status, titulo) => {
    await createCard({ titulo, projeto_id: selectedProjectId, status });
    setAddingStatus(null);
  };

  const handleMove = (cardId, status) => updateCard(cardId, { status });

  const handleEditSubmit = (payload) => updateCard(editingCardId, payload);

  const handleEditDelete = async (cardId) => {
    await deleteCard(cardId);
    setEditingCardId(null);
  };

  return (
    <div style={styles.page}>
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
                  return (
                    <div key={card.id} style={styles.card} data-testid={`board-v2-card-${card.id}`}>
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
                          {clienteNome && <span style={styles.tag}>{clienteNome}</span>}
                          {projetoNome && <span style={styles.tag}>{projetoNome}</span>}
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

              {addingStatus === status ? (
                <AddCardForm
                  onSubmit={(titulo) => handleCreate(status, titulo)}
                  onCancel={() => setAddingStatus(null)}
                />
              ) : selectedProjectId ? (
                <button type="button" style={styles.addBtn} onClick={() => setAddingStatus(status)}>
                  + Adicionar card
                </button>
              ) : (
                <div style={styles.hint}>Selecione um projeto na barra lateral para adicionar cards.</div>
              )}
            </div>
          );
        })}
      </div>

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
    </div>
  );
}
