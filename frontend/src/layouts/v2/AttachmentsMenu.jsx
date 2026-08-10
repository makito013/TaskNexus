// frontend/src/layouts/v2/AttachmentsMenu.jsx
//
// Header do Chat, Layout v2 ("Anexos por projeto"): botão pill renderizado ao
// lado de ResetLayoutButton.jsx (mesma guarda `!isMobile && v2Screen ===
// 'chat'` em AppV2.jsx) que abre um popover para subir/listar/remover anexos
// do PROJETO da sessão ativa, e "colar" o caminho absoluto de um anexo no
// terminal ativo sem enviar.
//
// Armazenamento é por PROJETO, não por sessão/agente (decisão de produto) —
// por isso o projectId usado em todas as chamadas de api.js vem de
// `activeSessionKey.split('::')[0]`, e não de alguma sessão específica.
// session_key é sempre "{projectId}::{agentId}" (às vezes com um 3º segmento
// aleatório pra instâncias duplicadas, ver TerminalContext.jsx) — projectId
// nunca contém "::", então o 1º segmento é sempre seguro.
//
// Popover: MESMO padrão ancorado de TaskQuickCreatePopover.jsx (scrim
// transparente + ESC + clique fora + fecha automaticamente quando a sessão
// ativa muda enquanto está aberto) — NÃO um bottom sheet (decisão do
// Designer: um sheet embaixo colidiria com o teclado do iPad).
//
// "Usar no chat" NUNCA envia a mensagem — só escreve o texto no input do
// terminal via POST /api/sessions/{sessionKey}/paste (sem \r). Upload/
// remoção/paste têm estado de loading/erro POR LINHA (nunca bloqueiam o
// painel inteiro): um upload falho fica retry-ável sem re-selecionar o
// arquivo, e a remoção usa confirmação inline de 2 toques (sem modal).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api.js';

const CONFIRM_REVERT_MS = 3000;
const PASTE_FEEDBACK_MS = 900;

function projectIdFromSessionKey(sessionKey) {
  return sessionKey ? sessionKey.split('::')[0] : null;
}

// Sem lib de formatação de bytes no projeto ainda — função pequena o
// suficiente pra não valer a pena extrair um util novo só para isto.
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSeconds < 60) return 'agora';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `há ${diffMinutes} min`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `há ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  return `há ${diffDays} d`;
}

// Mapeamento simples pedido pelo Designer: imagem / zip / "outro" — não vale
// uma tabela de mime types exaustiva para um ícone decorativo.
function iconForContentType(contentType) {
  if (!contentType) return '📄';
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType === 'application/zip' || contentType === 'application/x-zip-compressed') return '🗜️';
  return '📄';
}

const styles = {
  trigger: (disabled) => ({
    position: 'relative',
    flexShrink: 0,
    height: '28px',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-text)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }),
  badge: {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    minWidth: '16px',
    height: '16px',
    padding: '0 3px',
    borderRadius: '8px',
    background: 'var(--v2-accent)',
    color: 'var(--v2-surface)',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: '16px',
    textAlign: 'center',
  },
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'transparent',
    zIndex: 50,
  },
  panel: {
    position: 'fixed',
    top: '104px',
    right: '16px',
    width: 'min(360px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 130px)',
    overflowY: 'auto',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    boxShadow: 'var(--v2-shadow-lg)',
    padding: '14px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 51,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '12px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  closeBtn: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '16px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  addButton: {
    height: '36px',
    borderRadius: '8px',
    border: '1px dashed var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: '12px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  emptyNote: {
    fontSize: '12px',
    color: 'var(--v2-text-faint)',
    padding: '8px 0',
  },
  loadingNote: {
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    padding: '8px 0',
  },
  listErrorNote: {
    fontSize: '12px',
    color: 'var(--v2-danger)',
    padding: '8px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  rowIcon: {
    fontSize: '18px',
    flexShrink: 0,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  rowName: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowMeta: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
  },
  rowError: {
    fontSize: '11px',
    color: 'var(--v2-danger)',
  },
  rowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  actionBtn: {
    height: '26px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  actionBtnAccent: {
    height: '26px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--v2-accent)',
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  deleteBtn: (confirming) => ({
    height: '26px',
    padding: '0 8px',
    borderRadius: '6px',
    border: `1px solid ${confirming ? 'var(--v2-danger)' : 'var(--v2-border)'}`,
    background: confirming ? 'var(--v2-danger-soft)' : 'transparent',
    color: confirming ? 'var(--v2-danger)' : 'var(--v2-text-dim)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
};

export function AttachmentsMenu({ activeSessionKey }) {
  const disabled = !activeSessionKey;
  const projectId = projectIdFromSessionKey(activeSessionKey);

  const [open, setOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  // Uploads em voo/com falha, ainda não confirmados pelo backend — não fazem
  // parte de `attachments` (que só reflete o que já foi persistido).
  const [pendingUploads, setPendingUploads] = useState([]);
  // Estado por-linha de delete/paste, indexado por attachment.id.
  const [rowStates, setRowStates] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [pasteFeedbackId, setPasteFeedbackId] = useState(null);

  const confirmTimerRef = useRef(null);
  const pasteTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
  }, []);

  const fetchAttachments = useCallback(async () => {
    if (!projectId) return;
    setListLoading(true);
    setListError(false);
    try {
      const data = await api.listAttachments(projectId);
      setAttachments(data.attachments || []);
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) fetchAttachments();
  }, [open, fetchAttachments]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setConfirmDeleteId(null);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  // Listener de ESC só enquanto aberto — mesmo cuidado de
  // TaskQuickCreatePopover.jsx (não deixa um keydown global "vazando" quando
  // o popover está montado-mas-fechado).
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  // Fecha sozinho quando a sessão ativa muda enquanto está aberto — mesmo
  // mecanismo de TaskQuickCreatePopover.jsx. `prevKeyRef` começa igual à
  // activeSessionKey atual, então o 1º render nunca dispara isto.
  const prevKeyRef = useRef(activeSessionKey);
  useEffect(() => {
    if (open && prevKeyRef.current !== activeSessionKey) {
      handleClose();
    }
    prevKeyRef.current = activeSessionKey;
  }, [open, activeSessionKey, handleClose]);

  const setRowState = useCallback((id, patch) => {
    setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Sobe um lote de uploads pendentes (1 chamada multipart para o lote
  // inteiro), depois reconcilia cada entrada pendente com o que o backend
  // reportou em `attachments`/`errors` — sucesso parcial é o caso normal,
  // não uma exceção (ver AttachmentUploadResult no backend).
  const uploadBatch = useCallback(async (batch) => {
    if (!projectId || batch.length === 0) return;
    let result;
    try {
      result = await api.uploadAttachments(projectId, batch.map((entry) => entry.file));
    } catch {
      // Falha de rede/servidor antes de qualquer resposta — todo o lote
      // volta para o estado de erro, cada entrada retry-ável individualmente.
      const batchIds = new Set(batch.map((entry) => entry.tempId));
      setPendingUploads((prev) => prev.map((entry) => (
        batchIds.has(entry.tempId)
          ? { ...entry, status: 'error', errorMessage: 'Falha ao enviar — tentar novamente' }
          : entry
      )));
      return;
    }

    const remainingSuccess = [...result.attachments];
    const remainingErrors = [...result.errors];
    const resolvedIds = new Set();
    const nextByTempId = new Map();

    for (const entry of batch) {
      const successIdx = remainingSuccess.findIndex((a) => a.original_name === entry.file.name);
      if (successIdx !== -1) {
        remainingSuccess.splice(successIdx, 1);
        resolvedIds.add(entry.tempId); // sucesso: some da lista de pendentes
        continue;
      }
      const errorIdx = remainingErrors.findIndex((err) => err.original_name === entry.file.name);
      if (errorIdx !== -1) {
        const err = remainingErrors[errorIdx];
        remainingErrors.splice(errorIdx, 1);
        nextByTempId.set(entry.tempId, {
          ...entry,
          status: 'error',
          errorMessage: err.error || 'Falha ao enviar — tentar novamente',
        });
        continue;
      }
      // Defensivo: não deveria acontecer (todo upload enviado volta em
      // sucesso OU erro), mas nunca deixa a linha travada em "enviando".
      nextByTempId.set(entry.tempId, {
        ...entry,
        status: 'error',
        errorMessage: 'Falha ao enviar — tentar novamente',
      });
    }

    setPendingUploads((prev) => prev
      .filter((entry) => !resolvedIds.has(entry.tempId))
      .map((entry) => nextByTempId.get(entry.tempId) || entry));

    if (result.attachments.length > 0) fetchAttachments();
  }, [projectId, fetchAttachments]);

  const handleFilesSelected = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    // Reseta o input já aqui — permite selecionar o mesmo arquivo de novo
    // depois de uma falha, sem o browser considerar "sem mudança" no onChange.
    e.target.value = '';
    if (files.length === 0) return;

    const batch = files.map((file) => ({
      tempId: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: 'uploading',
      errorMessage: null,
    }));
    setPendingUploads((prev) => [...prev, ...batch]);
    uploadBatch(batch);
  }, [uploadBatch]);

  const handleRetryUpload = useCallback((entry) => {
    setPendingUploads((prev) => prev.map((p) => (
      p.tempId === entry.tempId ? { ...p, status: 'uploading', errorMessage: null } : p
    )));
    uploadBatch([entry]);
  }, [uploadBatch]);

  const handleDeleteClick = useCallback((attachmentId) => {
    if (confirmDeleteId === attachmentId) {
      // 2º toque: confirma a remoção.
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      setConfirmDeleteId(null);
      setRowState(attachmentId, { deleting: true, deleteError: null });
      api.deleteAttachment(projectId, attachmentId)
        .then(() => {
          setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
          setRowStates((prev) => {
            const next = { ...prev };
            delete next[attachmentId];
            return next;
          });
        })
        .catch(() => {
          setRowState(attachmentId, { deleting: false, deleteError: 'Falha ao remover' });
        });
      return;
    }

    // 1º toque: entra em modo "Remover?" por CONFIRM_REVERT_MS, revertendo
    // automaticamente (sem modal, confirmação inline de 2 toques).
    setConfirmDeleteId(attachmentId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      setConfirmDeleteId(null);
    }, CONFIRM_REVERT_MS);
  }, [confirmDeleteId, projectId, setRowState]);

  const handleUseInChat = useCallback((attachment) => {
    setRowState(attachment.id, { pasting: true, pasteError: null });
    // Espaço final deliberado (Designer): deixa o cursor pronto para o
    // usuário continuar digitando depois do caminho colado.
    api.pasteToSession(activeSessionKey, `${attachment.path} `)
      .then(() => {
        setRowState(attachment.id, { pasting: false });
        setPasteFeedbackId(attachment.id);
        if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
        pasteTimerRef.current = setTimeout(() => {
          pasteTimerRef.current = null;
          setPasteFeedbackId(null);
        }, PASTE_FEEDBACK_MS);
      })
      .catch(() => {
        setRowState(attachment.id, { pasting: false, pasteError: 'Falha ao colar' });
      });
  }, [activeSessionKey, setRowState]);

  const count = attachments.length;
  const badgeLabel = count > 9 ? '9+' : String(count);

  return (
    <>
      <button
        type="button"
        style={styles.trigger(disabled)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Anexos do projeto"
        data-testid="attachments-menu-trigger"
      >
        📎 Anexos
        {count > 0 && <span style={styles.badge}>{badgeLabel}</span>}
      </button>

      {open && (
        <div style={styles.scrim} onClick={handleClose} data-testid="attachments-menu-scrim">
          <div
            style={styles.panel}
            onClick={(e) => e.stopPropagation()}
            data-testid="attachments-menu-panel"
          >
            <div style={styles.headerRow}>
              <span style={styles.title}>Anexos</span>
              <button
                type="button"
                style={styles.closeBtn}
                aria-label="Fechar"
                onClick={handleClose}
              >
                ×
              </button>
            </div>

            <button
              type="button"
              style={styles.addButton}
              onClick={() => fileInputRef.current?.click()}
            >
              + Adicionar arquivo(s)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFilesSelected}
              data-testid="attachments-menu-file-input"
            />

            {listLoading && pendingUploads.length === 0 && attachments.length === 0 && (
              <div style={styles.loadingNote}>Carregando anexos…</div>
            )}

            {listError && (
              <div style={styles.listErrorNote} role="alert">
                <span>Falha ao carregar anexos.</span>
                <button type="button" style={styles.actionBtn} onClick={fetchAttachments}>
                  Tentar novamente
                </button>
              </div>
            )}

            <div style={styles.list}>
              {pendingUploads.map((entry) => (
                <div key={entry.tempId} style={styles.row} data-testid={`attachment-pending-${entry.tempId}`}>
                  <span style={styles.rowIcon}>📄</span>
                  <div style={styles.rowInfo}>
                    <span style={styles.rowName}>{entry.file.name}</span>
                    {entry.status === 'uploading' && (
                      <span style={styles.rowMeta}>Enviando…</span>
                    )}
                    {entry.status === 'error' && (
                      <span style={styles.rowError}>{entry.errorMessage}</span>
                    )}
                  </div>
                  {entry.status === 'error' && (
                    <div style={styles.rowActions}>
                      <button
                        type="button"
                        style={styles.actionBtn}
                        onClick={() => handleRetryUpload(entry)}
                      >
                        Tentar de novo
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {attachments.map((attachment) => {
                const rowState = rowStates[attachment.id] || {};
                const confirming = confirmDeleteId === attachment.id;
                return (
                  <div key={attachment.id} style={styles.row} data-testid={`attachment-row-${attachment.id}`}>
                    <span style={styles.rowIcon}>{iconForContentType(attachment.content_type)}</span>
                    <div style={styles.rowInfo}>
                      <span style={styles.rowName} title={attachment.original_name}>
                        {attachment.original_name}
                      </span>
                      <span style={styles.rowMeta}>
                        {formatBytes(attachment.size_bytes)} · {formatRelativeTime(attachment.uploaded_at)}
                      </span>
                      {rowState.deleteError && <span style={styles.rowError}>{rowState.deleteError}</span>}
                      {rowState.pasteError && <span style={styles.rowError}>{rowState.pasteError}</span>}
                    </div>
                    <div style={styles.rowActions}>
                      <button
                        type="button"
                        style={styles.actionBtnAccent}
                        disabled={rowState.pasting}
                        onClick={() => handleUseInChat(attachment)}
                      >
                        {pasteFeedbackId === attachment.id
                          ? '✓ Inserido'
                          : (rowState.pasting ? 'Colando…' : 'Usar no chat')}
                      </button>
                      <button
                        type="button"
                        style={styles.deleteBtn(confirming)}
                        disabled={rowState.deleting}
                        onClick={() => handleDeleteClick(attachment.id)}
                      >
                        {rowState.deleting ? 'Removendo…' : (confirming ? 'Remover?' : 'Remover')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {!listLoading && !listError && attachments.length === 0 && pendingUploads.length === 0 && (
              <div style={styles.emptyNote}>Nenhum anexo ainda.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
