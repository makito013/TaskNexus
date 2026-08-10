// frontend/src/components/board/CardItem.jsx
// Componente mais complexo do Board (Tarefa 23, 05-TL.md) — mesmo dado
// (`card`), duas variantes de layout: `row` (visão Lista, 05-DESIGNER.md
// seção 3) e `card` (visão Board, seção 4). Reaproveita `MoveCardMenu`
// (Tarefa 19), `ImageAttachments` (Tarefa 20) e `SubcardRow` (Tarefa 21) —
// este componente só orquestra esses três + o próprio título/badge/contador.
//
// Estado expandido/recolhido dos subcards é `useState` LOCAL, não sobe para
// o pai (BoardView/KanbanBoard) — decisão já fechada na seção 4.5 do
// Arquiteto, citada explicitamente na Tarefa 23: cada CardItem lembra sua
// própria expansão, sem precisar de um Set de ids no componente pai.
//
// Decisão — `ImageAttachments` na listagem é só visualização, sem botão de
// "+": passa `showAddButton={false}`, então a tira só aparece quando o card
// já tem imagens (miniaturas), e some por completo em cards sem nenhuma. O
// ponto de upload fica exclusivo do `CardFormModal` (card aberto) — evita
// poluir a listagem (linha/board) com um slot de upload por card, mesmo nos
// que nunca vão receber imagem.
//
// Decisão — vínculo de `onUploadImage`/`onDeleteImage` a `card.id`: em vez de
// exigir que o pai (KanbanBoard/BoardView) pré-vincule uma função por card
// (o que exigiria criar um closure por item de uma lista, só para satisfazer
// a assinatura de `ImageAttachments`), `CardItem` recebe as funções cruas de
// `useCards.js` — `uploadCardImage(cardId, file)` / `deleteCardImage(cardId,
// imageId)` (conferido em `frontend/src/hooks/useCards.js`) — e faz o bind
// aqui mesmo ao repassar para `ImageAttachments`. Isso deixa o contrato do
// pai mais simples: `onUploadImage={uploadCardImage}` direto, sem embrulhar
// nada por card. `CardFormModal` (Tarefa 22) segue a convenção oposta
// (recebe já vinculado) porque ali só existe 1 card por vez (o card sendo
// editado no modal) — aqui existem N cards renderizados de uma vez, então
// vincular no comsumidor de lista (`CardItem`) é o ponto certo.
//
// Decisão — badge de origem a partir de `ultima_atualizacao_por`: o modelo
// `Card` (backend/app/models.py) só guarda essa string, no formato "bruno"
// ou "agente:{agent_id}" — não guarda o campo `ia` do agente (esse vive em
// `Agent.ia`, escopo de outro fetch). Não há aqui nenhuma lista de agentes
// disponível para resolver agent_id -> ia com certeza, então a inferência é
// por substring do próprio agent_id (minúsculo): contém "claude" -> Claude
// (badge--claude); contém "gemini" -> Gemini (badge--gemini); contém "anti"
// -> Antigravity (badge--anti, cobre o id usado no mockup para essa IA).
// Qualquer outro agent_id (ou ausência de "agente:") cai em badge--none com
// o próprio texto (agent_id cru, ou "Bruno" quando `ultima_atualizacao_por`
// é literalmente "bruno") — fallback seguro que nunca finge saber uma IA que
// não conseguiu identificar, só rotula o texto bruto. Ponto de atenção para
// quem ligar isto ao `KanbanBoard`/`BoardView`: se no futuro os ids de
// agente customizados (`.escritorio/agents.yaml`) não contiverem essas
// substrings, o badge cai em --none — aceitável como uma v1, mas uma vitrine
// de agentes conhecidos (mapa explícito agent_id -> ia, vindo de
// `/api/projects`) resolveria com mais precisão se isso incomodar depois.
//
// Decisão — footer fixo por último na variante `card` (seção 4 do Designer):
// a ordem de render é título -> ImageAttachments -> contador -> subcards
// expandidos -> footer, SEMPRE nessa ordem no JSX (não há nenhum branch que
// insira algo depois do footer), garantindo que o pill de status nunca
// "pule de lugar" independente de quanto conteúdo existe acima.

import { useState } from 'react';
import { MoveCardMenu } from './MoveCardMenu.jsx';
import { ImageAttachments } from './ImageAttachments.jsx';
import { SubcardRow } from './SubcardRow.jsx';

const STATUS_LABELS = {
  a_fazer: 'A Fazer',
  em_andamento: 'Em Andamento',
  em_revisao: 'Em Revisão',
  feito: 'Feito',
};

const STATUS_DOT_COLOR = {
  a_fazer: 'var(--border-strong)',
  em_andamento: 'var(--accent-claude)',
  em_revisao: 'var(--state-attention)',
  feito: 'var(--accent-green)',
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Formata `atualizado_em` (epoch em segundos) como "há Xm"/"há Xh"/"há Xd" —
// sem lib de datas nova (o projeto não usa nenhuma, seção Technology Stack),
// resolução grosseira o suficiente para o badge de timestamp do mockup
// ("há 2h").
function formatRelativeTime(epochSeconds) {
  if (epochSeconds == null) return '';
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < MINUTE) return 'agora';
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)}h`;
  return `há ${Math.floor(diff / DAY)}d`;
}

// Ver decisão de badge no cabeçalho do arquivo.
function resolveOriginBadge(ultimaAtualizacaoPor) {
  if (!ultimaAtualizacaoPor || ultimaAtualizacaoPor === 'bruno') {
    return { className: 'badge--none', label: 'Bruno' };
  }
  if (ultimaAtualizacaoPor.startsWith('agente:')) {
    const agentId = ultimaAtualizacaoPor.slice('agente:'.length);
    const lower = agentId.toLowerCase();
    if (lower.includes('claude')) return { className: 'badge--claude', label: 'Claude' };
    if (lower.includes('gemini')) return { className: 'badge--gemini', label: 'Gemini' };
    if (lower.includes('anti')) return { className: 'badge--anti', label: 'Antigravity' };
    return { className: 'badge--none', label: agentId || 'Agente' };
  }
  return { className: 'badge--none', label: ultimaAtualizacaoPor };
}

const styles = {
  row: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '4px',
    padding: '10px 10px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: '2px',
    background: 'var(--bg-surface)',
  },
  rowMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minHeight: 'var(--touch-target)',
  },
  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: '13px',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  rowTime: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    minWidth: '48px',
    textAlign: 'right',
  },
  card: {
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardTitle: {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: '12.5px',
    lineHeight: 1.4,
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
  },
  statusPill: (compact) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    height: compact ? '26px' : '32px',
    padding: compact ? '0 8px 0 6px' : '0 10px',
    borderRadius: '999px',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    fontSize: compact ? '10px' : '12px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  }),
  dot: (status) => ({
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    flexShrink: 0,
    background: STATUS_DOT_COLOR[status],
  }),
  chev: {
    color: 'var(--text-muted)',
    fontSize: '9px',
  },
  counterRow: (highlight) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '36px',
    padding: '2px 4px',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    fontSize: '12px',
    color: highlight ? 'var(--accent-green)' : 'var(--text-muted)',
    cursor: 'pointer',
  }),
  subcardsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingLeft: '16px',
    borderLeft: '2px solid var(--border-strong)',
    marginLeft: '2px',
  },
  addSubtask: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '36px',
    border: '1px dashed var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
};

export function CardItem({
  card,
  variant,
  onMove,
  onOpenEdit,
  onMoveSubcard,
  onOpenEditSubcard,
  onUploadImage,
  onDeleteImage,
  onAddSubtask,
  clienteBadgeLabel,
}) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const resumo = card.subcards_resumo;
  const hasResumo = resumo != null;
  const allDone = hasResumo && resumo.total > 0 && resumo.feitos === resumo.total;
  const badge = resolveOriginBadge(card.ultima_atualizacao_por);
  const isCard = variant === 'card';

  const statusPill = (
    <button
      type="button"
      style={styles.statusPill(isCard)}
      aria-label={`Mover: ${STATUS_LABELS[card.status]}`}
      onClick={() => setMoveMenuOpen(true)}
    >
      <span style={styles.dot(card.status)} />
      {!isCard && <span>{STATUS_LABELS[card.status]}</span>}
      <span style={styles.chev}>▾</span>
    </button>
  );

  const imageAttachments = (
    <ImageAttachments
      cardId={card.id}
      imagens={card.imagens}
      onUpload={(file) => onUploadImage(card.id, file)}
      onDelete={(imageId) => onDeleteImage(card.id, imageId)}
      size={36}
      showAddButton={false}
    />
  );

  const counterRow = hasResumo && (
    <button
      type="button"
      style={styles.counterRow(allDone)}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <span>{resumo.feitos}/{resumo.total} subtarefas</span>
    </button>
  );

  // Card sem nenhuma subtarefa ainda: em vez de não mostrar nada (deixando um
  // "buraco" no layout e escondendo a única forma de criar a 1ª subtarefa
  // atrás do menu de edição), mostra sempre um botão de "+ subtarefa" no
  // mesmo slot — touch-first, sempre visível, sem exigir toque-longo/hover.
  // Reaproveita `styles.addSubtask` (mesmo componente visual do botão que já
  // existe dentro do bloco expandido) com a MESMA altura (~36px) de
  // `counterRow` para não haver "pulo" de layout ao ganhar/perder a 1ª
  // subtarefa. Clique chama `onAddSubtask` direto, sem tocar em
  // `expanded`/`setExpanded` — não há nada pra expandir ainda.
  const emptyAddButton = (
    <button
      type="button"
      style={styles.addSubtask}
      onClick={() => onAddSubtask(card.id)}
    >
      + subtarefa
    </button>
  );

  const subcardsBlock = expanded && (
    <div style={styles.subcardsWrap}>
      {(card.subcards || []).map((subcard) => (
        <SubcardRow
          key={subcard.id}
          subcard={subcard}
          onMove={onMoveSubcard}
          onOpenEdit={onOpenEditSubcard}
        />
      ))}
      <button
        type="button"
        style={styles.addSubtask}
        onClick={() => onAddSubtask(card.id)}
      >
        + subtarefa
      </button>
    </div>
  );

  return (
    <div
      className={isCard ? 'card' : 'row stack'}
      style={isCard ? styles.card : styles.row}
      data-testid={`card-item-${card.id}`}
    >
      {isCard ? (
        <button type="button" style={styles.cardTitle} onClick={() => onOpenEdit(card.id)}>
          {card.titulo}
        </button>
      ) : (
        <div className="row-main" style={styles.rowMain}>
          {statusPill}
          <div style={styles.rowTitleWrap}>
            <button type="button" style={styles.rowTitle} onClick={() => onOpenEdit(card.id)}>
              {card.titulo}
            </button>
          </div>
          <div style={styles.rowMeta}>
            {clienteBadgeLabel && <span className="badge badge--cliente">{clienteBadgeLabel}</span>}
            <span className={`badge ${badge.className}`}>{badge.label}</span>
            <span style={styles.rowTime}>{formatRelativeTime(card.atualizado_em)}</span>
          </div>
        </div>
      )}

      {imageAttachments}

      {hasResumo ? counterRow : emptyAddButton}
      {subcardsBlock}

      {isCard && (
        <div style={styles.cardFooter}>
          <span>
            {clienteBadgeLabel && (
              <span className="badge badge--cliente" style={{ marginRight: '4px' }}>{clienteBadgeLabel}</span>
            )}
            <span className={`badge ${badge.className}`}>{badge.label}</span>
          </span>
          {statusPill}
        </div>
      )}

      <MoveCardMenu
        open={moveMenuOpen}
        currentStatus={card.status}
        onMove={(novo) => onMove(card.id, novo)}
        onClose={() => setMoveMenuOpen(false)}
      />
    </div>
  );
}
