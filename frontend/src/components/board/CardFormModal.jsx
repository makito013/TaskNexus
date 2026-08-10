// frontend/src/components/board/CardFormModal.jsx
// Modal fullscreen de criar/editar card — 3 modos (Designer 05-DESIGNER.md
// seção 10; TL 05-TL.md Tarefa 22). Reaproveita o padrão visual já
// estabelecido em TaskDetailModal.jsx/AgentSettingsModal.jsx (overlay
// position:fixed, header com botão fechar 44x44, corpo com scroll, rodapé
// fixo com botão de submit).
//
// Modos:
// - 'create-top': campo Projeto visível, sem ImageAttachments (card ainda
//   não existe/não tem id), 4 chips de status.
// - 'create-subcard': igual ao create-top, mas SEM campo Projeto —
//   `projeto_id` é sempre herdado do pai no backend (05-ARQUITETO.md seção
//   1.2), mostrar um select que o backend ignora seria enganoso (Designer
//   seção 10.2).
// - 'edit': campos pré-preenchidos a partir de `card`, ImageAttachments
//   embutido (tamanho 48, Designer seção 10.1), botão "Excluir" no rodapé.
//
// Decisão — restrição de status em 'create-subcard': o TL pediu para reler
// se a regra "não cria direto em Feito/Em Revisão" é só do agente via MCP ou
// também da UI do Bruno. Conferido em 05-ARQUITETO.md seção 3 ("Contrato da
// tool MCP"): o enum restrito a ["a_fazer", "em_andamento"] aparece
// EXPLICITAMENTE dentro do schema da tool MCP (`inputSchema.properties.status.enum`)
// usado pelo agente, com o comentário "NÃO cria diretamente em 'Feito' — use
// 'a_fazer' ou 'em_andamento'" endereçado ao agente ("fora do chat").
// 05-DESIGNER.md seção 10.2 documenta a ÚNICA diferença do modo subcard como
// "sem o campo Projeto" — nenhuma menção a restringir status. Interpretação:
// a restrição é exclusiva do caminho MCP/agente; a UI do Bruno (este
// componente) sempre oferece as 4 opções de status em qualquer modo, porque
// o Bruno pode legitimamente querer criar uma subtarefa já concluída (ex.:
// registrando trabalho que já fez fora do fluxo). Os 4 chips de status são,
// portanto, idênticos nos 3 modos.
//
// Decisão — preview de markdown: em vez do segmented control
// "Markdown/Visualização" de TaskDetailModal (que existe lá para acomodar um
// `descricao_html` alternativo que Card não tem — Arquiteto 05-ARQUITETO.md
// seção 4.6), uso um botão simples "Visualizar" / "Editar" que alterna entre
// a textarea crua e o resultado de renderMarkdown() (dangerouslySetInnerHTML)
// no mesmo espaço — um estado a menos que um segmented control genérico, e
// cobre exatamente o que a seção 10.1 do Designer pede: "escrever markdown,
// ver renderizado", sem toggle manual entre dois modos permanentes.
//
// Decisão — aviso de exclusão em cascata: 05-DESIGNER.md seção 10.3 propõe
// reaproveitar o bottom sheet de MoveCardMenu para o aviso "Este card tem N
// subtarefa(s)...". O TL (05-TL.md Tarefa 22), ao delegar esta tarefa,
// relaxou essa exigência explicitamente ("decida a UX mais simples que ainda
// cumpra 'avisar antes', ex.: window.confirm() simples ou estado interno").
// Escolho `window.confirm()` com a MESMA copy do Designer (contagem de
// subcards, sem a palavra "permanentemente" — soft-delete, seção 10.3) —
// zero componente novo, zero chamada de rede (usa `card.subcards.length` já
// carregado), e o texto customizado do confirm() já cumpre o requisito de
// "avisar antes com a contagem". Cards sem subcards (ou subcards em si, que
// não têm subcards próprios) excluem direto, sem confirmação — fricção só
// onde a cascata é real, como pedido.
//
// Feature Cliente/Projeto — modo 'create-top' ganhou DOIS <select> empilhados
// no lugar do único select "Projeto" (lista achatada, todos os ids
// misturados) que existia antes: "Cliente" (obrigatório, opções = todos os
// Project com id sem "/") e "Projeto (opcional)" (só renderiza se o cliente
// escolhido tiver sub_projetos.length > 0; senão, texto informativo). Payload
// no submit: projeto específico escolhido -> `projeto_id` = esse id; senão
// -> `cliente_id` = o cliente escolhido (e `projeto_id` fica de fora do
// payload, deixando o backend resolver `projeto_id = cliente_id` — ver
// CardStore.create ramo 3). Modo 'create-subcard' continua sem nenhum campo
// Cliente/Projeto (herda do pai, já era assim).

import { useMemo, useState } from 'react';
import { renderMarkdown } from '../../utils/markdown.js';
import { ImageAttachments } from './ImageAttachments.jsx';

export function resolveProjectName(projetoId, projetos) {
  const found = (projetos || []).find((p) => p.id === projetoId);
  return found ? found.nome : projetoId;
}

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

const STATUS_ORDER = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];

const MODE_TITLES = {
  'create-top': 'Novo Card',
  'create-subcard': 'Nova Subtarefa',
  edit: 'Editar Card',
};

const SUBMIT_LABELS = {
  'create-top': 'Criar Card',
  'create-subcard': 'Criar Subtarefa',
  edit: 'Salvar',
};

const SUBMIT_LABELS_SAVING = {
  'create-top': 'Criando…',
  'create-subcard': 'Criando…',
  edit: 'Salvando…',
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'var(--bg-surface)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  closeBtn: {
    width: 'var(--touch-target)',
    height: 'var(--touch-target)',
    minWidth: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  title: {
    flex: 1,
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  formField: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: '180px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  markdownBody: {
    minHeight: '180px',
    padding: '10px 12px',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  previewToggle: {
    marginBottom: '8px',
    padding: '6px 12px',
    minHeight: '32px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  chipsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  chip: (active, color) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: `1px solid ${active ? color : 'var(--border-strong)'}`,
    background: active ? color : 'transparent',
    color: active ? 'var(--bg-surface)' : 'var(--text-primary)',
    fontSize: '13px',
    cursor: 'pointer',
  }),
  dot: (color) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    background: color,
  }),
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    flexShrink: 0,
  },
  deleteBtn: {
    padding: '10px 16px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--destructive)',
    background: 'transparent',
    color: 'var(--destructive)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '10px 18px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export function CardFormModal({
  open,
  mode,
  card,
  parentId,
  projetos,
  onSubmit,
  onDelete,
  onClose,
  onUploadImage,
  onDeleteImage,
}) {
  const isEdit = mode === 'edit';
  const showProjeto = mode === 'create-top';

  // "Clientes" candidatos ao 1º select: qualquer Project cujo id não tem "/"
  // (cliente-como-projeto e projeto-solto-na-raiz contam como cliente de si
  // mesmos — mesma regra usada pela cascata de filtro em BoardView.jsx).
  const clientesOptions = useMemo(
    () => (projetos || []).filter((p) => !p.id.includes('/')),
    [projetos]
  );
  const [selectedClienteId, setSelectedClienteId] = useState(() =>
    clientesOptions[0] ? clientesOptions[0].id : ''
  );
  // '' = nenhum projeto específico escolhido (card cliente-only).
  const [selectedProjetoId, setSelectedProjetoId] = useState('');

  const selectedCliente = clientesOptions.find((p) => p.id === selectedClienteId);
  const clienteHasSubprojects = !!selectedCliente && (selectedCliente.sub_projetos || []).length > 0;

  const handleSelectCliente = (novoClienteId) => {
    setSelectedClienteId(novoClienteId);
    setSelectedProjetoId(''); // trocar de cliente sempre reseta o 2º select
  };

  const [titulo, setTitulo] = useState(() => card?.titulo || '');
  const [status, setStatus] = useState(() => card?.status || 'a_fazer');
  const [descricao, setDescricao] = useState(() => card?.descricao || '');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleDelete = async () => {
    if (!card) return;
    const subcount = card.subcards?.length || 0;
    if (subcount > 0) {
      const ok = window.confirm(
        `Este card tem ${subcount} subtarefa(s). Apagar o card também apaga as subtarefas junto. Excluir mesmo assim?`
      );
      if (!ok) return;
    }
    await onDelete(card.id);
  };

  const handleSubmit = async () => {
    const trimmedTitulo = titulo.trim();
    if (!trimmedTitulo || saving) return;
    setSaving(true);
    try {
      const payload = { titulo: trimmedTitulo, status, descricao };
      if (showProjeto) {
        if (selectedProjetoId) {
          payload.projeto_id = selectedProjetoId;
        } else {
          payload.cliente_id = selectedClienteId;
        }
      }
      if (mode === 'create-subcard') payload.parent_id = parentId;
      if (isEdit) payload.id = card.id;
      await onSubmit(payload);
      onClose();
    } catch (e) {
      alert('Falha ao salvar card. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <button style={styles.closeBtn} aria-label="Fechar" onClick={onClose}>
          ×
        </button>
        <div style={styles.title}>{MODE_TITLES[mode]}</div>
      </div>

      <div style={styles.body}>
        {showProjeto && (
          <div style={styles.formField}>
            <label style={styles.label} htmlFor="card-cliente">Cliente</label>
            <select
              id="card-cliente"
              style={styles.select}
              value={selectedClienteId}
              onChange={(e) => handleSelectCliente(e.target.value)}
            >
              {clientesOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
        )}

        {showProjeto && (
          <div style={styles.formField}>
            {clienteHasSubprojects ? (
              <>
                <label style={styles.label} htmlFor="card-projeto">Projeto (opcional)</label>
                <select
                  id="card-projeto"
                  style={styles.select}
                  value={selectedProjetoId}
                  onChange={(e) => setSelectedProjetoId(e.target.value)}
                >
                  <option value="">Nenhum (vincula direto ao cliente)</option>
                  {(selectedCliente.sub_projetos || []).map((subId) => (
                    <option key={subId} value={subId}>{resolveProjectName(subId, projetos)}</option>
                  ))}
                </select>
              </>
            ) : (
              <span style={styles.label}>
                Este cliente não tem subprojetos — os cards ficam vinculados direto a{' '}
                {selectedCliente ? selectedCliente.nome : selectedClienteId}.
              </span>
            )}
          </div>
        )}

        <div style={styles.formField}>
          <label style={styles.label} htmlFor="card-titulo">Título</label>
          <input
            id="card-titulo"
            style={styles.input}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título do card"
            autoFocus
          />
        </div>

        <div style={styles.formField}>
          <label style={styles.label}>Status inicial</label>
          <div style={styles.chipsRow}>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                style={styles.chip(status === s, STATUS_DOT_COLOR[s])}
                onClick={() => setStatus(s)}
              >
                <span style={styles.dot(status === s ? 'var(--bg-surface)' : STATUS_DOT_COLOR[s])} />
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.formField}>
          <label style={styles.label} htmlFor="card-descricao">Descrição (Markdown)</label>
          <button
            type="button"
            style={styles.previewToggle}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? 'Editar' : 'Visualizar'}
          </button>
          {showPreview ? (
            <div
              data-testid="card-descricao-preview"
              style={styles.markdownBody}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(descricao) }}
            />
          ) : (
            <textarea
              id="card-descricao"
              style={styles.textarea}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva o card em markdown..."
            />
          )}
        </div>

        {isEdit && (
          <div style={styles.formField}>
            <label style={styles.label}>Imagens</label>
            <ImageAttachments
              cardId={card.id}
              imagens={card.imagens}
              onUpload={onUploadImage}
              onDelete={onDeleteImage}
              size={48}
            />
          </div>
        )}
      </div>

      <div style={styles.footer}>
        {isEdit ? (
          <button style={styles.deleteBtn} onClick={handleDelete}>Excluir</button>
        ) : (
          <span />
        )}
        <button
          style={{ ...styles.submitBtn, opacity: saving || !titulo.trim() ? 0.6 : 1 }}
          disabled={saving || !titulo.trim()}
          onClick={handleSubmit}
        >
          {saving ? SUBMIT_LABELS_SAVING[mode] : SUBMIT_LABELS[mode]}
        </button>
      </div>
    </div>
  );
}
