// frontend/src/layouts/v2/BoardV2.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): versão v2 do Board —
// kanban horizontal com scroll-x, uma coluna FIXA de 300px por status (não
// por projeto — diferente de KanbanBoard.jsx v1, que agrupa em swimlanes por
// projeto). Reaproveita `useCards` (frontend/src/hooks/useCards.js) tal como
// está: mesmo hook, mesmas ações (createCard, updateCard) que
// views/BoardView.jsx (v1) já usa — só a apresentação muda, conforme
// instrução do Designer/TL para este milestone.
//
// Filtro de listagem/agregação (Fase 2 do plano, fix do Bruno: um card criado
// dentro de um subprojeto ficava invisível no board sem um chat aberto
// NAQUELE subprojeto específico): `selectedClienteId` vem do mesmo estado que
// AppV2.jsx já calcula pra sidebar de clientes (`handleSelectCliente`) e já
// repassa pra TarefasV2 — DESACOPLADO de `selectedProjectId` (o projeto do
// chat ativo no TerminalContext). `selectedProjectIds` agrega
// `[selectedClienteId, ...subProjetoIds]` (subprojetos de
// `projects.find(p => p.id === selectedClienteId)?.sub_projetos`), mesma
// fórmula de `views/BoardView.jsx` (v1) pro caso "Todos" (null) -> []; "só
// Cliente" -> cliente + todos os subprojetos. Sem cascata Tier 2 de Projeto
// específico aqui (isso continua fora do escopo desta tela). Sem cliente
// selecionado, `useCards([])` busca cards de TODOS os projetos (mesmo
// comportamento "Todos" de v1) e o card mostra uma tag com o nome do projeto
// para dar contexto; com exatamente 1 projeto agregado (cliente sem
// subprojetos), a tag é redundante e some.
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
// NÃO implementado nesta tela (ver relatório do Dev): subcards/upload de
// imagem — a especificação de card do Designer para BoardV2 pede apenas
// título + descrição + avatar + tag, sem contador de subtarefas nem anexos.
// Não expandido silenciosamente: é um corte de escopo deliberado, não uma
// lacuna esquecida.

import { useMemo, useState } from 'react';
import { useCards } from '../../hooks/useCards.js';

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
  cardTitle: {
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

function resolveProjectName(projetoId, projects) {
  const found = (projects || []).find((p) => p.id === projetoId);
  return found ? found.nome : projetoId;
}

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
  // Subprojetos do cliente selecionado (formato de id completo
  // "cliente/sub", conforme `Project.sub_projetos` já vem do backend) — mesma
  // fonte usada por BoardView.jsx (v1) pra agregação Tier 1.
  const subProjetoIds = useMemo(() => {
    const found = projects.find((p) => p.id === selectedClienteId);
    return found?.sub_projetos || [];
  }, [projects, selectedClienteId]);

  const selectedProjectIds = useMemo(
    () => (selectedClienteId == null ? [] : [selectedClienteId, ...subProjetoIds]),
    [selectedClienteId, subProjetoIds]
  );

  const { cards, createCard, updateCard } = useCards(selectedProjectIds);

  // Coluna com o formulário de "+ Adicionar card" aberto (null = nenhuma).
  const [addingStatus, setAddingStatus] = useState(null);

  const handleCreate = async (status, titulo) => {
    await createCard({ titulo, projeto_id: selectedProjectId, status });
    setAddingStatus(null);
  };

  const handleMove = (cardId, status) => updateCard(cardId, { status });

  return (
    <div style={styles.page}>
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
                {columnCards.map((card) => (
                  <div key={card.id} style={styles.card} data-testid={`board-v2-card-${card.id}`}>
                    <div style={styles.cardTitle}>{card.titulo}</div>
                    {card.descricao && <div style={styles.cardDesc}>{card.descricao}</div>}
                    <div style={styles.cardFooter}>
                      <div style={styles.cardMeta}>
                        <span style={styles.avatar} title={card.ultima_atualizacao_por || 'bruno'}>
                          {resolveAvatarInitials(card.ultima_atualizacao_por)}
                        </span>
                        {/* Redundante quando a agregação atual resolve a exatamente 1
                            projeto (cliente sem subprojetos, ou "Todos" nunca chega
                            aqui com length 1) — some nesse único caso; "Todos" (length
                            0) e cliente com múltiplos subprojetos (length > 1) mantêm a
                            tag pra desambiguar de qual projeto cada card é. */}
                        {selectedProjectIds.length !== 1 && (
                          <span style={styles.tag}>{resolveProjectName(card.projeto_id, projects)}</span>
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
                ))}
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
    </div>
  );
}
