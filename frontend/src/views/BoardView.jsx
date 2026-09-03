// frontend/src/views/BoardView.jsx
// Tela cheia do Board (rota /board) — Tarefa 26 de 05-TL.md, ÚLTIMA peça do
// Board: junta tudo que as tarefas 14-25 já construíram (useCards,
// ProjectGroupHeader, KanbanBoard, CardItem, CardFormModal,
// ClearFinishedModal) numa única tela navegável. Ver 05-DESIGNER.md seções
// 3, 5 e 11 para o layout de referência (visão Lista agrupada por projeto,
// sub-toggle Lista/Board, botão "Limpar concluídos" por grupo/lane).
//
// `ClienteProjetoFilterBar` NÃO é um componente próprio (mesmo raciocínio de
// antes do `ProjectFilterBar` que ele substitui): não existe uma tarefa
// separada pra ele em 05-TL.md, então em vez de inventar um arquivo novo
// fora do que foi planejado, implemento a cascata de filtro como uma função
// de componente interna deste mesmo arquivo.
//
// Feature Cliente/Projeto — cascata de filtro (substitui o antigo
// `ProjectFilterBar` multi-select): Tier 1 = Cliente (chips, "Todos" como
// reset, single-select — nunca mais de um cliente por vez). Tier 2 =
// Projeto, só renderiza quando o cliente selecionado tem
// `sub_projetos.length > 0` (via `projectHasSubprojects`); senão mostra um
// texto informativo ("este cliente não tem subprojetos"). Trocar de Cliente
// sempre reseta a seleção de Projeto. O array final passado a `useCards` é
// derivado por uma única fórmula (`selectedProjectIds` abaixo): "Todos" ->
// []; só Cliente -> [clienteId, ...subProjetoIds do cliente] (agrega
// cliente-only + todos os subprojetos); Cliente+Projeto -> [clienteId,
// projetoId] (cliente entra pra cards cliente-only continuarem aparecendo
// mesmo com um subprojeto específico selecionado).
//
// Decisão importante — "Limpar concluídos" na visão Board (ver também o
// comentário mais detalhado perto do JSX que usa `boardClearEnabled` mais
// abaixo): `KanbanBoard.jsx` (Tarefa 24) foi construído deliberadamente SEM
// esse botão por lane — a prop não fazia parte da lista de props da Tarefa
// 24, e o próprio arquivo documenta a decisão de deixar essa peça para a
// Tarefa 26 (aqui). Como `KanbanBoard.jsx` está FORA do escopo autorizado
// desta tarefa (não posso editá-lo para adicionar um botão por lane), a
// solução pragmática adotada é: um único botão "Limpar concluídos" GLOBAL na
// topbar da visão Board, operando sobre o "tier mais específico" selecionado
// no filtro (`selectedProjetoId ?? selectedClienteId` — nunca o array
// agregado, que pode ter 2 elementos legitimamente agora). Sem nenhum tier
// selecionado o botão fica desabilitado (com texto explicativo), porque o
// endpoint/`ClearFinishedModal` operam sobre UM `projeto_id` por vez. Na
// visão Lista este problema não existe: cada grupo de projeto já tem seu
// próprio botão, exatamente como o Designer especificou (seção 11.1).
// Documentado também no relatório final do Dev como ponto em aberto para o
// Bruno decidir se quer uma versão melhor depois (ex.: `KanbanBoard` ganhar
// o botão por lane numa iteração futura).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { useCards } from '../hooks/useCards.js';
import { ProjectGroupHeader } from '../components/ProjectGroupHeader.jsx';
import { KanbanBoard } from '../components/board/KanbanBoard.jsx';
import { CardItem } from '../components/board/CardItem.jsx';
import { CardFormModal } from '../components/board/CardFormModal.jsx';
import { ClearFinishedModal } from '../components/board/ClearFinishedModal.jsx';
import { projectHasSubprojects, resolveClienteBadgeLabel } from '../utils/clientes.js';

// Mesmo padrão de persistência de `useSidebarCollapsed` em App.jsx: chave
// própria no localStorage, lida uma vez no estado inicial (lazy initializer),
// escrita via useEffect a cada mudança, ambos os lados tolerantes a falha
// (Safari privado/quota etc. não devem quebrar a tela).
const VIEW_MODE_KEY = 'escritorio::board_view_mode';

function useViewMode() {
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      if (stored === 'lista' || stored === 'board') return stored;
    } catch { /* ignore */ }
    return 'lista';
  });

  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); }
    catch { /* ignore */ }
  }, [viewMode]);

  return [viewMode, setViewMode];
}

function resolveProjectName(projetoId, projetos) {
  const found = (projetos || []).find((p) => p.id === projetoId);
  return found ? found.nome : projetoId;
}

// Agrupa `cards` (lista plana) por `projeto_id`, na ordem de primeira
// aparição — mesmo espírito de `groupByProject` em KanbanBoard.jsx (não
// reordena alfabeticamente por nome resolvido, para não fazer a ordem mudar
// conforme o nome de exibição muda).
function groupCardsByProject(cards, projetos) {
  const order = [];
  const byProject = new Map();
  for (const card of cards) {
    const key = card.projeto_id;
    if (!byProject.has(key)) {
      byProject.set(key, []);
      order.push(key);
    }
    byProject.get(key).push(card);
  }
  return order.map((projetoId) => ({
    projetoId,
    label: resolveProjectName(projetoId, projetos),
    cards: byProject.get(projetoId),
  }));
}

// Procura um card por id, incluindo dentro de `subcards` de cada card de
// topo — usado tanto por onOpenEdit (card de topo) quanto onOpenEditSubcard
// (subcard), que compartilham a mesma busca.
function findCardById(cards, cardId) {
  for (const card of cards) {
    if (card.id === cardId) return card;
    const sub = (card.subcards || []).find((s) => s.id === cardId);
    if (sub) return sub;
  }
  return null;
}

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  topbarTitle: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    flex: 1,
    minWidth: '120px',
  },
  chip: (active) => ({
    display: 'inline-flex',
    alignItems: 'center',
    height: '36px',
    padding: active ? '0 14px 0 12px' : '0 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    borderLeft: active ? '2px solid var(--accent-green)' : '1px solid var(--border)',
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
  subtoggle: {
    display: 'flex',
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    height: '36px',
    padding: '2px',
    gap: '2px',
    flexShrink: 0,
  },
  subtoggleBtn: (active) => ({
    padding: '0 16px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  }),
  newCardBtn: {
    flexShrink: 0,
    padding: '0 14px',
    height: '36px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  boardTopbarExtra: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 16px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  tier2Bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 16px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  hint: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  listWrap: {
    padding: '0 16px 24px',
  },
  groupHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  groupHeaderMain: {
    flex: 1,
    minWidth: 0,
  },
  clearBtn: (disabled) => ({
    flexShrink: 0,
    height: '30px',
    padding: '0 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    fontSize: '11px',
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
  }),
  groupBody: {
    padding: '0 0 8px',
  },
  stateWrap: {
    margin: 'auto',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px',
    padding: '48px 24px',
  },
};

// Tier 1 da cascata: chips de Cliente (single-select) + "Todos" (reset).
// "Cliente" = qualquer Project cujo id não tem "/" (cliente-como-projeto e
// projeto-solto-na-raiz contam como cliente de si mesmos, mesma regra do
// segundo select do CardFormModal). Implementado inline neste arquivo — ver
// comentário no topo do arquivo sobre por que não é um componente/arquivo
// separado.
function ClienteFilterBar({ clientes, selectedClienteId, onSelect }) {
  return (
    <div style={styles.chips}>
      <button
        type="button"
        style={styles.chip(selectedClienteId == null)}
        onClick={() => onSelect(null)}
      >
        Todos
      </button>
      {clientes.map((p) => (
        <button
          key={p.id}
          type="button"
          style={styles.chip(selectedClienteId === p.id)}
          onClick={() => onSelect(p.id)}
        >
          {p.nome}
        </button>
      ))}
    </div>
  );
}

// Tier 2 da cascata: chips de Projeto dentro do Cliente selecionado —
// só é chamado quando o cliente selecionado tem sub_projetos (o pai decide
// se renderiza este componente ou o texto informativo). "Todos" aqui
// significa "nenhum projeto específico" (agrega cliente + todos os
// subprojetos), não "limpar o cliente".
function ProjetoFilterBar({ subProjetoIds, selectedProjetoId, onSelect, projetos }) {
  return (
    <div style={styles.chips}>
      <button
        type="button"
        style={styles.chip(selectedProjetoId == null)}
        onClick={() => onSelect(null)}
      >
        Todos
      </button>
      {subProjetoIds.map((projetoId) => (
        <button
          key={projetoId}
          type="button"
          style={styles.chip(selectedProjetoId === projetoId)}
          onClick={() => onSelect(projetoId)}
        >
          {resolveProjectName(projetoId, projetos)}
        </button>
      ))}
    </div>
  );
}

export function BoardView({ navigate }) {
  // `navigate` não é usado por esta tela (o Board não navega para lugar
  // nenhum sozinho — quem troca de tela é o AppLauncherHeader, já montado
  // por App.jsx). Mantido na assinatura só por paridade de prop-shape com o
  // roteador (mesmo padrão de TarefasGlobalView), sem uso real aqui.
  void navigate;

  const [projetos, setProjetos] = useState([]);
  const [projetosLoading, setProjetosLoading] = useState(true);

  // Busca /api/projects uma vez ao montar — usada para resolver projeto_id
  // -> nome de exibição (nos chips, nos grupos da Lista, nas lanes do
  // Board via KanbanBoard) e para popular o select de projeto do
  // CardFormModal em modo create.
  useEffect(() => {
    let cancelled = false;
    api.fetchProjects()
      .then((list) => { if (!cancelled) setProjetos(list); })
      .catch((e) => {
        console.warn('fetchProjects error (BoardView)', e);
      })
      .finally(() => { if (!cancelled) setProjetosLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const [viewMode, setViewMode] = useViewMode();
  // Não persistido (ao contrário de viewMode) — filtro de cliente/projeto é
  // uma preferência momentânea da sessão de uso, não algo que faça sentido
  // sobreviver a um reload/dia seguinte (mesmo racional de collapsedGroups
  // em TarefasGlobalView, que também não persiste). Dois tiers separados em
  // vez de um único array multi-select (ver comentário no topo do arquivo).
  const [selectedClienteId, setSelectedClienteId] = useState(null);
  const [selectedProjetoId, setSelectedProjetoId] = useState(null);

  // Trocar de Cliente sempre reseta a seleção de Projeto (Tier 2) — nunca
  // faz sentido manter um projeto de um cliente diferente selecionado.
  const selectCliente = useCallback((clienteId) => {
    setSelectedClienteId(clienteId);
    setSelectedProjetoId(null);
  }, []);

  // "Clientes" candidatos ao Tier 1: qualquer Project cujo id não tem "/"
  // (inclui cliente-como-projeto e projeto-solto-na-raiz, que são clientes
  // de si mesmos).
  const clientes = useMemo(
    () => projetos.filter((p) => !p.id.includes('/')),
    [projetos]
  );
  const selectedClienteHasSubprojects = selectedClienteId != null
    && projectHasSubprojects(selectedClienteId, projetos);
  const selectedClienteSubProjetoIds = useMemo(() => {
    const found = projetos.find((p) => p.id === selectedClienteId);
    return found?.sub_projetos || [];
  }, [projetos, selectedClienteId]);

  // Array final passado a useCards — ver fórmula documentada no topo do
  // arquivo (Todos -> []; só Cliente -> agrega cliente + subprojetos;
  // Cliente+Projeto -> só os 2 ids específicos).
  const selectedProjectIds = useMemo(() => {
    if (selectedClienteId == null) return [];
    if (selectedProjetoId != null) return [selectedClienteId, selectedProjetoId];
    return [selectedClienteId, ...selectedClienteSubProjetoIds];
  }, [selectedClienteId, selectedProjetoId, selectedClienteSubProjetoIds]);

  const {
    cards,
    createCard,
    createSubcard,
    updateCard,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  } = useCards(selectedProjectIds);

  // Grupos colapsados da visão Lista — local, não persistido, mesmo padrão
  // de collapsedGroups em TarefasGlobalView.jsx. Independente do collapse de
  // lane que KanbanBoard já gerencia internamente (são visões diferentes,
  // sem necessidade de sincronizar estado de UI entre elas).
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = useCallback((key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Estado do CardFormModal: null = fechado; caso contrário
  // { mode: 'create' | 'create-subcard' | 'edit', card?, parentId? }.
  //
  // ⚠️ 'create-subcard' NÃO existe mais no CardFormModal (subcards viraram
  // MCP-only) — este ramo é resíduo da v1, que sai inteira na Fase 3. Abrir
  // "+ Subtarefa" aqui renderiza o modal sem título de modo. Não vale
  // consertar uma tela agendada para deleção; 'create' e 'edit', que são os
  // caminhos vivos desta view, continuam funcionando.
  const [formState, setFormState] = useState(null);
  const closeForm = useCallback(() => setFormState(null), []);

  const openCreateTop = useCallback(() => setFormState({ mode: 'create' }), []);
  const openCreateSubcard = useCallback(
    (parentId) => setFormState({ mode: 'create-subcard', parentId }),
    []
  );
  const openEdit = useCallback(
    (cardId) => {
      const found = findCardById(cards, cardId);
      if (found) setFormState({ mode: 'edit', card: found });
    },
    [cards]
  );

  // onSubmit do CardFormModal: o próprio modal chama onClose() depois que a
  // promise resolve (ver CardFormModal.jsx handleSubmit) — não preciso
  // fechar o form aqui de novo. Os payloads extras que o modal injeta
  // (`id` no modo edit) são ignorados sem problema pelos destructurings de
  // api.js (createCard/updateCard/createSubcard só leem os campos que usam).
  const handleSubmit = useCallback(
    async (payload) => {
      if (!formState) return;
      if (formState.mode === 'create') {
        await createCard(payload);
      } else if (formState.mode === 'create-subcard') {
        await createSubcard(formState.parentId, payload);
      } else if (formState.mode === 'edit') {
        await updateCard(formState.card.id, payload);
      }
    },
    [formState, createCard, createSubcard, updateCard]
  );

  // onDelete do CardFormModal: diferente de onSubmit, o modal NÃO fecha
  // sozinho após excluir (ver CardFormModal.jsx handleDelete — só chama
  // `await onDelete(card.id)`, sem onClose() depois) — então fechamos aqui.
  // Se deleteCard rejeitar (useCards já mostra alert() e relança), o
  // closeForm() abaixo não roda e o modal permanece aberto para nova
  // tentativa.
  const handleDelete = useCallback(
    async (cardId) => {
      await deleteCard(cardId);
      closeForm();
    },
    [deleteCard, closeForm]
  );

  // onMove/onMoveSubcard: o mesmo PATCH genérico serve os dois (card de
  // topo ou subcard), conforme a Tarefa 26 especifica.
  const handleMove = useCallback(
    (cardId, novoStatus) => updateCard(cardId, { status: novoStatus }),
    [updateCard]
  );

  const cardItemProps = useMemo(
    () => ({
      onMove: handleMove,
      onOpenEdit: openEdit,
      onMoveSubcard: handleMove,
      onOpenEditSubcard: openEdit,
      onUploadImage: uploadCardImage,
      onDeleteImage: deleteCardImage,
      onAddSubtask: openCreateSubcard,
    }),
    [handleMove, openEdit, uploadCardImage, deleteCardImage, openCreateSubcard]
  );

  // "Limpar concluídos" — projeto alvo do modal de confirmação atualmente
  // aberto (null = fechado). Serve tanto os botões por grupo da Lista quanto
  // o botão global da topbar do Board (ver decisão documentada no topo do
  // arquivo).
  const [clearFinishedProjectId, setClearFinishedProjectId] = useState(null);
  const closeClearFinished = useCallback(() => setClearFinishedProjectId(null), []);

  // Só considera cards de TOPO com status 'feito' — mesma regra
  // determinística que `clearFinished` de useCards.js já aplica ao remover
  // do estado local (subcards não contam isoladamente para "tem concluído").
  const projectHasFinished = useCallback(
    (projetoId) => cards.some((c) => c.projeto_id === projetoId && c.status === 'feito'),
    [cards]
  );

  // Visão Board: o projeto "endereçável" pelo botão global é o tier mais
  // específico selecionado no filtro — Projeto (Tier 2) se houver, senão
  // Cliente (Tier 1), senão nenhum ("Todos"). Diferente de antes
  // (`selectedProjectIds.length === 1`), o array agregado agora pode ter 2
  // elementos legitimamente (cliente + subprojeto), então checar o
  // comprimento do array deixou de fazer sentido — ver decisão documentada
  // no topo do arquivo.
  const mostSpecificProjectId = selectedProjetoId ?? selectedClienteId;
  const boardClearEnabled = mostSpecificProjectId != null && projectHasFinished(mostSpecificProjectId);

  const listGroups = useMemo(() => groupCardsByProject(cards, projetos), [cards, projetos]);

  if (projetosLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.stateWrap}>Carregando...</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topbar}>
        <span style={styles.topbarTitle}>Board</span>
        <ClienteFilterBar
          clientes={clientes}
          selectedClienteId={selectedClienteId}
          onSelect={selectCliente}
        />
        <div style={styles.subtoggle}>
          <button
            type="button"
            style={styles.subtoggleBtn(viewMode === 'lista')}
            onClick={() => setViewMode('lista')}
          >
            Lista
          </button>
          <button
            type="button"
            style={styles.subtoggleBtn(viewMode === 'board')}
            onClick={() => setViewMode('board')}
          >
            Board
          </button>
        </div>
        <button type="button" style={styles.newCardBtn} onClick={openCreateTop}>
          + Novo Card
        </button>
      </div>

      {/* Tier 2 da cascata — só aparece com um Cliente selecionado. Mostra
          os chips de Projeto quando o cliente tem subprojetos, ou um texto
          informativo quando o cliente-como-projeto/projeto-solto-na-raiz
          não tem nenhum (ver comentário no topo do arquivo). */}
      {selectedClienteId != null && (
        <div style={styles.tier2Bar}>
          {selectedClienteHasSubprojects ? (
            <ProjetoFilterBar
              subProjetoIds={selectedClienteSubProjetoIds}
              selectedProjetoId={selectedProjetoId}
              onSelect={setSelectedProjetoId}
              projetos={projetos}
            />
          ) : (
            <span style={styles.hint}>
              Este cliente não tem subprojetos — os cards ficam vinculados direto a{' '}
              {resolveProjectName(selectedClienteId, projetos)}
            </span>
          )}
        </div>
      )}

      {/* Botão global "Limpar concluídos" da visão Board — ver decisão
          documentada no topo do arquivo sobre por que é global (não por
          lane) e por que opera sobre o tier mais específico selecionado
          (Projeto se houver, senão Cliente, senão nenhum). */}
      {viewMode === 'board' && (
        <div style={styles.boardTopbarExtra}>
          <button
            type="button"
            disabled={!boardClearEnabled}
            style={styles.clearBtn(!boardClearEnabled)}
            title={boardClearEnabled ? undefined : 'Selecione um cliente ou projeto para limpar concluídos'}
            onClick={() => { if (boardClearEnabled) setClearFinishedProjectId(mostSpecificProjectId); }}
          >
            Limpar concluídos
          </button>
          {!boardClearEnabled && (
            <span style={styles.hint}>Selecione um cliente ou projeto para limpar concluídos</span>
          )}
        </div>
      )}

      <div style={styles.main}>
        {cards.length === 0 ? (
          <div style={styles.stateWrap}>Nenhum card ainda.</div>
        ) : viewMode === 'lista' ? (
          <div style={styles.listWrap}>
            {listGroups.map((group) => {
              const collapsed = collapsedGroups.has(group.projetoId);
              const hasFinished = group.cards.some((c) => c.status === 'feito');
              return (
                <div key={group.projetoId}>
                  <div style={styles.groupHeaderRow}>
                    <div style={styles.groupHeaderMain}>
                      <ProjectGroupHeader
                        label={group.label}
                        count={group.cards.length}
                        countLabel="cards"
                        collapsed={collapsed}
                        onToggle={() => toggleGroup(group.projetoId)}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!hasFinished}
                      style={styles.clearBtn(!hasFinished)}
                      onClick={() => { if (hasFinished) setClearFinishedProjectId(group.projetoId); }}
                    >
                      Limpar concluídos
                    </button>
                  </div>
                  {!collapsed && (
                    <div style={styles.groupBody}>
                      {group.cards.map((card) => (
                        <CardItem
                          key={card.id}
                          card={card}
                          variant="row"
                          clienteBadgeLabel={resolveClienteBadgeLabel(card.projeto_id, projetos, selectedClienteId == null)}
                          {...cardItemProps}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <KanbanBoard
            cards={cards}
            projetos={projetos}
            showAllClientes={selectedClienteId == null}
            {...cardItemProps}
          />
        )}
      </div>

      {formState && (
        <CardFormModal
          open
          mode={formState.mode}
          card={formState.card}
          parentId={formState.parentId}
          projetos={projetos}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          onClose={closeForm}
          onUploadImage={formState.card ? (file) => uploadCardImage(formState.card.id, file) : undefined}
          onDeleteImage={formState.card ? (imageId) => deleteCardImage(formState.card.id, imageId) : undefined}
        />
      )}

      {clearFinishedProjectId && (
        <ClearFinishedModal
          open
          projetoId={clearFinishedProjectId}
          projetoNome={resolveProjectName(clearFinishedProjectId, projetos)}
          onPreview={previewClearFinished}
          onExecute={clearFinished}
          onClose={closeClearFinished}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
