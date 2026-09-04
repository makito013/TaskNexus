// frontend/src/components/board/CardFormModal.jsx
// Centred card modal (Jira-shaped): a main column for the content the card is
// about, a right rail for its metadata, and the card id pinned in the header.
//
// Two modes, `create` and `edit`. The old `create-subcard` mode is GONE:
// subcards have no UI surface any more, they are created by agents through
// MCP. `create-top` was renamed `create` in the same pass — a modal that only
// creates top-level cards does not need the qualifier.
//
// Layout contract (the parts that are easy to break):
// - The overlay centres the panel with FLEXBOX. Never
//   `transform: translate(-50%, -50%)`: the v2 shell forbids `transform` on
//   any ancestor of a `position: fixed` element, and this modal is meant to
//   stay consistent with that chain even though this file is not one of the
//   files `fixedPositioningInvariant.test.js` guards.
// - Header and footer are `flex-shrink: 0`; ONE scroll region between them
//   (`flex: 1; min-height: 0; overflow-y: auto`) holds both the main column
//   and the rail. Two scroll regions side by side is what makes a long
//   description and a short rail scroll out of sync.
// - `max-height` declares the `100vh` fallback IMMEDIATELY BEFORE the `100dvh`
//   line. Order matters: a browser without `dvh` keeps the last value it
//   understood, and iPad Safari is the browser that needs it.
//
// Responsiveness: single breakpoint at 720px via `useMediaQuery`, which
// stacks the rail below the main column. ⚠️ jsdom has no `matchMedia`, so the
// hook always returns `false` there and EVERY Vitest test exercises the
// desktop branch. The stacked branch is manual QA.
//
// Closing (✕ / ESC / click on the overlay) discards without confirming, the
// same as TaskQuickCreatePopover. No body scroll lock: `html`/`body`/`#root`
// are already `overflow: hidden` globally.
//
// Dirty tracking, and why it has two branches — this is the part that breaks
// production if it is "simplified" into one payload builder:
// - `edit` sends ONLY the fields the user actually touched. An untouched
//   field is absent from the payload, `JSON.stringify` drops it, and the
//   backend leaves it alone. That is what keeps the modal from clobbering a
//   field an agent edited while it was open.
// - `create` sends the payload COMPLETE. Gating creation by the dirty set
//   means a user who never opens the Cliente select submits without
//   `projeto_id` AND without `cliente_id`, and `CardStore.create` raises
//   ValueError -> 400.
// Same asymmetry on the empty value: `create` maps an empty tipo/prazo to
// `null` (a `""` there is a 422 against `CardCreateRequest`), while `edit`
// sends `""` deliberately as the "clear this field" sentinel that
// `CardStore.update` turns into NULL.
//
// Mounting: `if (!open) return null` sits AFTER the hooks, and the `useState`
// initialisers are lazy. A parent that keeps this mounted with `open={false}`
// therefore freezes the `create` defaults at its first render — open, close,
// change the filter, reopen, and the old client comes back. Parents must
// mount it conditionally (BoardV2 does) or give it a `key` that changes per
// opening.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_TIPO_COLORS, CARD_TIPO_LABELS, CARD_TIPOS, formatDataCriacao } from '../../utils/cardMeta.js';
import { clienteIdFromProjetoId } from '../../utils/clientes.js';
import { renderMarkdown } from '../../utils/markdown.js';
import { resolveProjectLabel } from '../../utils/projects.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { CardIdBadge } from './CardIdBadge.jsx';
import { ImageAttachments } from './ImageAttachments.jsx';

const NARROW_QUERY = '(max-width: 720px)';

const STATUS_LABELS = {
  a_fazer: 'A Fazer',
  em_andamento: 'Em Andamento',
  em_revisao: 'Em Revisão',
  feito: 'Feito',
};

const STATUS_DOT_COLOR = {
  a_fazer: 'var(--v2-text-faint)',
  em_andamento: 'var(--v2-accent-2)',
  em_revisao: 'var(--v2-warn)',
  feito: 'var(--v2-accent)',
};

const STATUS_ORDER = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];

const MODE_TITLES = { create: 'Novo Card', edit: 'Editar Card' };
const SUBMIT_LABELS = { create: 'Criar Card', edit: 'Salvar' };
const SUBMIT_LABELS_SAVING = { create: 'Criando…', edit: 'Salvando…' };

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    background: 'var(--v2-scrim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
  },
  panel: {
    position: 'relative',
    zIndex: 61,
    width: 'min(880px, calc(100vw - 48px))',
    // The 100vh line MUST stay immediately above the 100dvh line — see header.
    maxHeight: 'min(720px, calc(100vh - 48px))',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    boxShadow: 'var(--v2-shadow-lg)',
    overflow: 'hidden',
    outline: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    flexShrink: 0,
  },
  headerSpacer: { flex: 1, minWidth: 0 },
  closeBtn: {
    width: '36px',
    height: '36px',
    minWidth: '36px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  contentRow: (narrow) => ({
    display: 'flex',
    flexDirection: narrow ? 'column' : 'row',
    alignItems: 'stretch',
  }),
  main: {
    flex: 1,
    minWidth: 0,
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  rail: (narrow) => ({
    width: narrow ? 'auto' : '260px',
    minWidth: narrow ? 0 : '260px',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    background: 'var(--v2-surface-2)',
    borderLeft: narrow ? 'none' : '1px solid var(--v2-border)',
    borderTop: narrow ? '1px solid var(--v2-border)' : 'none',
  }),
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: {
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    color: 'var(--v2-text-dim)',
  },
  readonlyValue: {
    fontSize: '13px',
    color: 'var(--v2-text)',
    wordBreak: 'break-word',
  },
  control: (surface) => ({
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: '44px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: `var(--v2-surface-${surface})`,
    color: 'var(--v2-text)',
    fontSize: '14px',
  }),
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: '200px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  markdownBody: {
    minHeight: '200px',
    padding: '10px 12px',
    boxSizing: 'border-box',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  linkBtn: {
    padding: '2px 4px',
    border: 'none',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '11px',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  chipsRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  statusChip: (active, color) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    minHeight: '38px',
    borderRadius: '999px',
    border: `1px solid ${active ? color : 'var(--v2-border)'}`,
    background: active ? 'var(--v2-surface-3)' : 'transparent',
    color: active ? 'var(--v2-text)' : 'var(--v2-text-dim)',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  }),
  dot: (color) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    background: color,
  }),
  tipoChip: (tipo) => ({
    alignSelf: 'flex-start',
    padding: '3px 8px',
    borderRadius: '6px',
    background: CARD_TIPO_COLORS[tipo].soft,
    color: CARD_TIPO_COLORS[tipo].strong,
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '.06em',
  }),
  hint: { fontSize: '12px', color: 'var(--v2-text-faint)', lineHeight: 1.4 },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    flexShrink: 0,
  },
  footerActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  deleteBtn: {
    padding: '10px 16px',
    minHeight: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-danger)',
    background: 'transparent',
    color: 'var(--v2-danger)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '10px 16px',
    minHeight: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  submitBtn: (disabled) => ({
    padding: '10px 18px',
    minHeight: '40px',
    borderRadius: '8px',
    border: `1px solid ${disabled ? 'var(--v2-border)' : 'var(--v2-accent)'}`,
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
};

// Which client/project the `create` mode should open on. Kept pure and out of
// the component so the "defaults come from the active filter" rule can be
// read in one place.
//
// `defaultProjetoId` is only honoured when it is a DIRECT child of the chosen
// client: the second select only lists direct children, and pre-selecting a
// value that is not among the options silently blanks the select.
function resolveCreateDefaults(clientesOptions, defaultClienteId, defaultProjetoId) {
  const ids = clientesOptions.map((p) => p.id);
  const fromProjeto = defaultProjetoId ? clienteIdFromProjetoId(defaultProjetoId) : null;
  const clienteId = [defaultClienteId, fromProjeto].find((id) => id && ids.includes(id))
    ?? (ids[0] ?? '');

  const cliente = clientesOptions.find((p) => p.id === clienteId);
  const subProjetos = cliente ? (cliente.sub_projetos || []) : [];
  const projetoId = defaultProjetoId && subProjetos.includes(defaultProjetoId) ? defaultProjetoId : '';

  return { clienteId, projetoId };
}

export function CardFormModal({
  open,
  mode,
  card,
  projetos,
  defaultClienteId = null,
  defaultProjetoId = null,
  defaultStatus = null,
  onSubmit,
  onDelete,
  onClose,
  onUploadImage,
  onDeleteImage,
}) {
  const isEdit = mode === 'edit';
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const panelRef = useRef(null);
  // Whether the press that started the current click landed on the overlay.
  // A click event resolves to the common ancestor of mousedown and mouseup,
  // so selecting text inside the textarea and releasing past the panel edge
  // would otherwise read as "clicked the overlay" and discard the draft.
  // Defaults to true so a bare click (no preceding mousedown) still closes.
  const pressStartedOnOverlay = useRef(true);

  // Candidate "clients" for the first select: any Project whose id has no "/"
  // (a client-as-project and a loose root project both count as their own
  // client — the same rule the filter cascade uses).
  const clientesOptions = useMemo(
    () => (projetos || []).filter((p) => !p.id.includes('/')),
    [projetos]
  );

  const [selectedClienteId, setSelectedClienteId] = useState(
    () => resolveCreateDefaults(clientesOptions, defaultClienteId, defaultProjetoId).clienteId
  );
  // '' = no specific project chosen (a client-only card).
  const [selectedProjetoId, setSelectedProjetoId] = useState(
    () => resolveCreateDefaults(clientesOptions, defaultClienteId, defaultProjetoId).projetoId
  );

  const [titulo, setTitulo] = useState(() => card?.titulo || '');
  const [status, setStatus] = useState(() => card?.status || defaultStatus || 'a_fazer');
  const [descricao, setDescricao] = useState(() => card?.descricao || '');
  const [tipo, setTipo] = useState(() => card?.tipo || '');
  const [prazo, setPrazo] = useState(() => card?.prazo || '');
  // Opens already rendered when editing a card that already has a
  // description — reopening an existing card should not throw raw markdown at
  // the reader. A new card, or one with no description yet, opens raw.
  const [showPreview, setShowPreview] = useState(() => isEdit && !!card?.descricao);
  const [saving, setSaving] = useState(false);

  // Keys the user actually touched. Only `edit` reads this; see the header.
  const [dirtyFields, setDirtyFields] = useState(() => new Set());
  const markDirty = (key) => setDirtyFields((prev) => {
    if (prev.has(key)) return prev;
    const next = new Set(prev);
    next.add(key);
    return next;
  });

  // ESC closes. The listener is registered only while open, and removed on
  // unmount — the classic leak of this pattern is a modal that keeps
  // answering ESC after it is gone.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // In `edit` the panel itself takes focus instead of an input: autofocusing a
  // text field raises the iPad keyboard over a modal the user only opened to
  // read. In `create` the Título input carries `autoFocus` and wins.
  useEffect(() => {
    if (open && isEdit) panelRef.current?.focus();
  }, [open, isEdit]);

  if (!open) return null;

  const selectedCliente = clientesOptions.find((p) => p.id === selectedClienteId);
  const clienteHasSubprojects = !!selectedCliente && (selectedCliente.sub_projetos || []).length > 0;

  const handleSelectCliente = (novoClienteId) => {
    setSelectedClienteId(novoClienteId);
    setSelectedProjetoId(''); // changing client always resets the 2nd select
  };

  // Client/project of the card being edited: the client name feeds the header
  // badge, the project name feeds the read-only rail row.
  const editClienteId = isEdit && card?.projeto_id ? clienteIdFromProjetoId(card.projeto_id) : null;
  const editClienteNome = editClienteId ? resolveProjectLabel(editClienteId, projetos) : null;
  const editProjetoNome = isEdit && card?.projeto_id && card.projeto_id !== editClienteId
    ? resolveProjectLabel(card.projeto_id, projetos)
    : null;

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

  // Complete payload. `tipo`/`prazo` empty means "not set", which on the
  // create contract is `null` — never `""`, which is a 422.
  const buildCreatePayload = (trimmedTitulo) => {
    const payload = {
      titulo: trimmedTitulo,
      status,
      descricao,
      tipo: tipo || null,
      prazo: prazo || null,
    };
    if (selectedProjetoId) payload.projeto_id = selectedProjetoId;
    else payload.cliente_id = selectedClienteId;
    return payload;
  };

  // Touched fields only. An untouched key is ABSENT, not null: `api.updateCard`
  // rebuilds a fixed key list and `JSON.stringify` drops `undefined`, so an
  // absent key never reaches the backend and the stored value survives.
  // `""` is present on purpose — it is the clear-the-field sentinel.
  const buildEditPayload = (trimmedTitulo) => {
    const payload = { id: card.id };
    if (dirtyFields.has('titulo')) payload.titulo = trimmedTitulo;
    if (dirtyFields.has('status')) payload.status = status;
    if (dirtyFields.has('descricao')) payload.descricao = descricao;
    if (dirtyFields.has('tipo')) payload.tipo = tipo;
    if (dirtyFields.has('prazo')) payload.prazo = prazo;
    return payload;
  };

  const handleSubmit = async () => {
    const trimmedTitulo = titulo.trim();
    if (!trimmedTitulo || saving) return;
    // Nothing changed: a Salvar click that touched no field must not fire a
    // PATCH. An empty-body PATCH still makes the backend rewrite
    // `ultima_atualizacao_por`, stealing the attribution from whoever last
    // edited the card. `create` has no such gate — its payload is always
    // complete.
    if (isEdit && dirtyFields.size === 0) { onClose(); return; }
    setSaving(true);
    try {
      await onSubmit(isEdit ? buildEditPayload(trimmedTitulo) : buildCreatePayload(trimmedTitulo));
      onClose();
    } catch {
      alert('Falha ao salvar card. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const submitDisabled = saving || !titulo.trim();

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressStartedOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="v2-card-modal-enter"
        style={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={MODE_TITLES[mode]}
        tabIndex={-1}
      >
        <div style={styles.header}>
          <span style={styles.headerTitle}>{MODE_TITLES[mode]}</span>
          {isEdit && (
            <CardIdBadge id={card.id} clienteNome={editClienteNome} variant="modal" />
          )}
          <span style={styles.headerSpacer} />
          <button type="button" style={styles.closeBtn} aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.contentRow(isNarrow)}>
            <div style={styles.main}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="card-titulo">Título</label>
                <input
                  id="card-titulo"
                  style={styles.control(2)}
                  value={titulo}
                  onChange={(e) => { setTitulo(e.target.value); markDirty('titulo'); }}
                  placeholder="Título do card"
                  autoFocus={!isEdit}
                />
              </div>

              <div style={styles.field}>
                <span style={styles.label}>Status</span>
                <div style={styles.chipsRow}>
                  {STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      type="button"
                      style={styles.statusChip(status === s, STATUS_DOT_COLOR[s])}
                      onClick={() => { setStatus(s); markDirty('status'); }}
                    >
                      <span style={styles.dot(STATUS_DOT_COLOR[s])} />
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div style={styles.field}>
                <div style={styles.labelRow}>
                  <label style={styles.label} htmlFor="card-descricao">Descrição (Markdown)</label>
                  <button
                    type="button"
                    style={styles.linkBtn}
                    onClick={() => setShowPreview((v) => !v)}
                  >
                    {showPreview ? 'Editar' : 'Visualizar'}
                  </button>
                </div>
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
                    onChange={(e) => { setDescricao(e.target.value); markDirty('descricao'); }}
                    placeholder="Descreva o card em markdown..."
                  />
                )}
              </div>

              {isEdit && (
                <div style={styles.field}>
                  <span style={styles.label}>Imagens</span>
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

            <div style={styles.rail(isNarrow)}>
              {isEdit ? (
                <>
                  {/* No "Cliente" row here: the client name shows once, beside
                      the id in the header (via CardIdBadge). The rail keeps
                      only what the header does not carry. */}
                  <div style={styles.field}>
                    <span style={styles.label}>Projeto</span>
                    <span style={styles.readonlyValue}>{editProjetoNome || '—'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={styles.field}>
                    <label style={styles.label} htmlFor="card-cliente">Cliente</label>
                    <select
                      id="card-cliente"
                      style={styles.control(3)}
                      value={selectedClienteId}
                      onChange={(e) => handleSelectCliente(e.target.value)}
                    >
                      {clientesOptions.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.field}>
                    {clienteHasSubprojects ? (
                      <>
                        <label style={styles.label} htmlFor="card-projeto">Projeto (opcional)</label>
                        <select
                          id="card-projeto"
                          style={styles.control(3)}
                          value={selectedProjetoId}
                          onChange={(e) => setSelectedProjetoId(e.target.value)}
                        >
                          <option value="">Nenhum (vincula direto ao cliente)</option>
                          {(selectedCliente.sub_projetos || []).map((subId) => (
                            <option key={subId} value={subId}>{resolveProjectLabel(subId, projetos)}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span style={styles.hint}>
                        Este cliente não tem subprojetos — os cards ficam vinculados direto a{' '}
                        {selectedCliente ? selectedCliente.nome : selectedClienteId}.
                      </span>
                    )}
                  </div>
                </>
              )}

              <div style={styles.field}>
                <label style={styles.label} htmlFor="card-tipo">Tipo</label>
                <select
                  id="card-tipo"
                  style={styles.control(3)}
                  value={tipo}
                  onChange={(e) => { setTipo(e.target.value); markDirty('tipo'); }}
                >
                  <option value="">Sem tipo</option>
                  {CARD_TIPOS.map((t) => (
                    <option key={t} value={t}>{CARD_TIPO_LABELS[t]}</option>
                  ))}
                </select>
                {tipo && CARD_TIPO_COLORS[tipo] && (
                  <span style={styles.tipoChip(tipo)}>{CARD_TIPO_LABELS[tipo]}</span>
                )}
              </div>

              <div style={styles.field}>
                <div style={styles.labelRow}>
                  <label style={styles.label} htmlFor="card-prazo">Prazo</label>
                  {prazo && (
                    // The iPad's native clear affordance on <input type="date">
                    // is inconsistent, hence an explicit button.
                    <button
                      type="button"
                      style={styles.linkBtn}
                      onClick={() => { setPrazo(''); markDirty('prazo'); }}
                    >
                      limpar
                    </button>
                  )}
                </div>
                <input
                  id="card-prazo"
                  type="date"
                  style={styles.control(3)}
                  value={prazo}
                  onChange={(e) => { setPrazo(e.target.value); markDirty('prazo'); }}
                />
                {!prazo && <span style={styles.hint}>Sem prazo</span>}
              </div>

              {isEdit && (
                <div style={styles.field}>
                  <span style={styles.label}>Criado em</span>
                  <span style={styles.readonlyValue}>{formatDataCriacao(card.criado_em) || '—'}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          {isEdit ? (
            <button type="button" style={styles.deleteBtn} onClick={handleDelete}>Excluir</button>
          ) : (
            <span />
          )}
          <div style={styles.footerActions}>
            <button type="button" style={styles.cancelBtn} onClick={onClose}>Cancelar</button>
            <button
              type="button"
              style={styles.submitBtn(submitDisabled)}
              disabled={submitDisabled}
              onClick={handleSubmit}
            >
              {saving ? SUBMIT_LABELS_SAVING[mode] : SUBMIT_LABELS[mode]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
