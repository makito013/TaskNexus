// frontend/src/components/board/CardAttachments.jsx
// File attachments of a board card (any type), shown in the card's edit modal.
//
// Each row has "Ver" (opens the file in the TaskNexus file viewer: markdown,
// PDF, HTML, images, text) and "Baixar". Clicking the file name does the same
// as "Ver" when the type has a preview, and downloads otherwise.
//
// "Baixar" is a real <a href download> pointing at `?download=1` (the backend
// answers with Content-Disposition: attachment), never fetch + blob: on the
// iPad/PWA only a link tapped by the user triggers the native download.
//
// "Dumb" component like ImageAttachments: it receives `onUpload`, `onDelete`
// and `onView` already bound to the card by the parent. Upload errors are
// alerted one level up (useCards); this component only keeps its own visual
// state so it never gets stuck on "Enviando…".
import { useCallback, useRef, useState } from 'react';
import { cardAttachmentItem, fileUrl } from '../../features/viewer/viewerApi.js';
import { formatBytes } from '../../features/viewer/viewerPaths.js';

export const MAX_ATTACHMENTS = 10;
const ERROR_DISPLAY_MS = 3000;

// Types the viewer renders (the backend decides the final `kind`; anything
// else still opens, but only as a "no preview, download" card — so for those
// the row offers just "Baixar").
const PREVIEWABLE_RE = /\.(md|markdown|pdf|html?|txt|log|csv|json|xml|ya?ml|png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export function isPreviewable(filename) {
  return PREVIEWABLE_RE.test(String(filename || ''));
}

function extensionLabel(filename) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename || ''));
  return match ? match[1].toUpperCase() : 'ARQ';
}

const styles = {
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    border: '1px solid var(--v2-border)',
    borderRadius: '8px',
    background: 'var(--v2-surface-2)',
    minWidth: 0,
  },
  ext: {
    flexShrink: 0,
    minWidth: '38px',
    padding: '3px 4px',
    borderRadius: '5px',
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    fontSize: '10px',
    fontWeight: 700,
    textAlign: 'center',
    letterSpacing: '0.02em',
  },
  nameButton: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    color: 'var(--v2-text)',
    font: 'inherit',
    display: 'flex',
    flexDirection: 'column',
  },
  name: {
    fontSize: '13px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  size: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
  },
  action: (primary) => ({
    flexShrink: 0,
    height: '30px',
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '6px',
    border: `1px solid ${primary ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    background: primary ? 'var(--v2-accent)' : 'var(--v2-surface)',
    color: primary ? '#fff' : 'var(--v2-text)',
    fontSize: '12px',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
  }),
  remove: {
    flexShrink: 0,
    width: '30px',
    height: '30px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '16px',
    cursor: 'pointer',
  },
  addButton: (hasError) => ({
    alignSelf: 'flex-start',
    marginTop: '6px',
    height: '32px',
    padding: '0 12px',
    borderRadius: '6px',
    border: `1px dashed ${hasError ? 'var(--v2-danger)' : 'var(--v2-border)'}`,
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '12px',
    cursor: 'pointer',
  }),
  note: (danger) => ({
    fontSize: '11px',
    color: danger ? 'var(--v2-danger)' : 'var(--v2-text-faint)',
    marginTop: '4px',
  }),
};

export function CardAttachments({ cardId, attachments, onUpload, onDelete, onView }) {
  const inputRef = useRef(null);
  const [uploadState, setUploadState] = useState('idle'); // 'idle' | 'uploading' | 'error'
  const list = attachments || [];
  const atLimit = list.length >= MAX_ATTACHMENTS;

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files && event.target.files[0];
    // Reset right away so picking the same file again after an error still
    // fires onChange.
    event.target.value = '';
    if (!file) return;
    setUploadState('uploading');
    try {
      await onUpload(file);
      setUploadState('idle');
    } catch {
      setUploadState('error');
      setTimeout(() => setUploadState('idle'), ERROR_DISPLAY_MS);
    }
  }, [onUpload]);

  return (
    <div data-testid={`card-attachments-${cardId}`}>
      {list.length > 0 && (
        <ul style={styles.list}>
          {list.map((attachment) => {
            const item = cardAttachmentItem(attachment);
            const previewable = isPreviewable(attachment.filename);
            const downloadHref = fileUrl(item, item.path, { download: true });
            return (
              <li key={attachment.id} style={styles.row} data-testid={`card-attachment-${attachment.id}`}>
                <span style={styles.ext} aria-hidden="true">{extensionLabel(attachment.filename)}</span>
                {previewable ? (
                  <button
                    type="button"
                    style={styles.nameButton}
                    onClick={() => onView(attachment)}
                    title={`Abrir ${attachment.filename} no visualizador`}
                  >
                    <span style={styles.name}>{attachment.filename}</span>
                    <span style={styles.size}>{formatBytes(attachment.size_bytes)}</span>
                  </button>
                ) : (
                  <a
                    href={downloadHref}
                    download={attachment.filename}
                    style={{ ...styles.nameButton, textDecoration: 'none' }}
                    title={`Baixar ${attachment.filename}`}
                  >
                    <span style={styles.name}>{attachment.filename}</span>
                    <span style={styles.size}>{formatBytes(attachment.size_bytes)}</span>
                  </a>
                )}
                {previewable && (
                  <button
                    type="button"
                    style={styles.action(true)}
                    onClick={() => onView(attachment)}
                    aria-label={`Ver ${attachment.filename}`}
                  >
                    Ver
                  </button>
                )}
                <a
                  href={downloadHref}
                  download={attachment.filename}
                  style={styles.action(false)}
                  aria-label={`Baixar ${attachment.filename}`}
                >
                  Baixar
                </a>
                <button
                  type="button"
                  style={styles.remove}
                  onClick={() => onDelete(attachment.id)}
                  aria-label={`Remover ${attachment.filename}`}
                  title="Remover anexo"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!atLimit && (
        <button
          type="button"
          style={styles.addButton(uploadState === 'error')}
          onClick={() => inputRef.current?.click()}
          disabled={uploadState === 'uploading'}
          data-testid="card-attachments-add"
        >
          {uploadState === 'uploading' ? 'Enviando…' : '📎 Anexar arquivo'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        data-testid={`card-attachments-input-${cardId}`}
      />

      {atLimit && (
        <div style={styles.note(false)} data-testid="card-attachments-limit-note">
          {MAX_ATTACHMENTS}/{MAX_ATTACHMENTS} anexos
        </div>
      )}
      {uploadState === 'error' && (
        <div role="alert" style={styles.note(true)}>Falha ao enviar o anexo.</div>
      )}
    </div>
  );
}
