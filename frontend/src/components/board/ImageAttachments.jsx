// frontend/src/components/board/ImageAttachments.jsx
// Tira de miniaturas de anexos de imagem de um card (Designer 05-DESIGNER.md
// seção 7; spec visual/comportamental em 05-mockup.html — classes
// .img-strip/.img-thumb/.img-add e função viewImage). 05-TL.md Tarefa 20.
//
// Componente "burro"/reutilizável: não conhece useCards.js — recebe
// `onUpload`/`onDelete` via props, já vinculadas ao `cardId` pelo componente
// pai (ex.: CardItem/CardFormModal chamando `(file) => uploadCardImage(cardId,
// file)`). `cardId` aqui só é usado para compor ids/testids estáveis (input
// de arquivo, mensagens), nunca passado para onUpload/onDelete.
//
// Decisão: <img src={imagem.url}> real em vez de placeholder colorido do
// mockup. O mockup usa quadrados coloridos porque é um HTML estático sem
// arquivos reais — mas `CardImage.url` (backend/app/models.py) é sempre um
// path real servido estaticamente (`/board_uploads/{card_id}/{filename}`),
// então renderizar a imagem de verdade é estritamente mais útil pro Bruno
// (reconhecer o print pela miniatura) sem custo extra de complexidade. Trato
// falha de carregamento (`onError`) com fallback para o mesmo ícone SVG de
// "foto genérica" do mockup, por card de imagem individualmente (um anexo
// quebrado não derruba os outros).
//
// Erros de upload: `onUpload` já vem de `useCards().uploadCardImage`, que por
// sua vez já dispara `alert()` num nível acima (padrão de mutação já
// estabelecido, 05-ARQUITETO.md seção 2) — este componente NÃO duplica esse
// alert(). Mas como o componente é "burro" e pode ser reusado com qualquer
// `onUpload`, ele mantém seu próprio estado visual de erro (borda
// `--destructive` no slot de upload + mensagem curta abaixo da tira por
// alguns segundos) para nunca deixar a UI "travada" silenciosamente num
// quadrado pulsante caso a promise rejeite — isso é comportamento próprio do
// componente, independente de o chamador também mostrar um alert().
//
// Exclusão: em vez de long-press (mais frágil de detectar de forma confiável
// em touch + mais complexo de testar), uso um botão "×" pequeno no canto de
// cada miniatura — interação mais simples e igualmente touch-friendly para
// esse contexto (mesma lógica do Designer para não forçar --touch-target de
// 44px na miniatura em si: a miniatura de 36px já é intencionalmente menor,
// e o botão de exclusão embutido nela segue a mesma lógica de "controle
// pequeno dentro de uma célula maior").

import { useRef, useState, useCallback } from 'react';

const MAX_IMAGES = 5;
const ERROR_DISPLAY_MS = 3000;

function PhotoIcon({ size }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

const styles = {
  strip: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    margin: '8px 0',
    alignItems: 'flex-start',
  },
  thumbWrap: (size) => ({
    position: 'relative',
    width: `${size}px`,
    height: `${size}px`,
    flexShrink: 0,
  }),
  thumbImg: (size) => ({
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: 'var(--radius-sm)',
    objectFit: 'cover',
    display: 'block',
    cursor: 'pointer',
    background: 'var(--bg-surface-3)',
  }),
  thumbPlaceholder: (size) => ({
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface-3)',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  }),
  deleteBtn: {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-secondary)',
    fontSize: '10px',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  addSlot: (size, hasError) => ({
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: 'var(--radius-sm)',
    border: `1px dashed ${hasError ? 'var(--destructive)' : 'var(--border-strong)'}`,
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'pointer',
  }),
  uploadingSlot: (size) => ({
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface-3)',
    flexShrink: 0,
    animation: 'pulse 2s ease-in-out infinite',
  }),
  limitNote: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    margin: '-2px 0 6px',
  },
  errorNote: {
    fontSize: '10px',
    color: 'var(--destructive)',
    margin: '-2px 0 6px',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.9)',
    zIndex: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayClose: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    width: '44px',
    height: '44px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-secondary)',
    fontSize: '16px',
    cursor: 'pointer',
  },
  overlayImg: {
    maxWidth: '92vw',
    maxHeight: '80vh',
    objectFit: 'contain',
    borderRadius: 'var(--radius-sm)',
  },
};

export function ImageAttachments({ cardId, imagens, onUpload, onDelete, size = 36, showAddButton = true }) {
  const fileInputRef = useRef(null);
  const [uploadState, setUploadState] = useState('idle'); // 'idle' | 'uploading' | 'error'
  const [brokenIds, setBrokenIds] = useState(() => new Set());
  const [fullscreenImage, setFullscreenImage] = useState(null);

  const list = imagens || [];
  const atLimit = list.length >= MAX_IMAGES;

  // Sem botão de adicionar (ex.: listagem de cards) e sem nenhuma imagem
  // ainda, não há nada pra essa tira mostrar — evita o gap vazio de 8px de
  // margem que a `strip` deixaria sem nenhum filho.
  if (!showAddButton && list.length === 0) return null;

  const markBroken = useCallback((imageId) => {
    setBrokenIds((prev) => {
      const next = new Set(prev);
      next.add(imageId);
      return next;
    });
  }, []);

  const handleAddClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    // Reseta o input já aqui — permite selecionar o mesmo arquivo de novo
    // depois de um erro, sem o browser considerar "sem mudança" no onChange.
    e.target.value = '';
    if (!file) return;

    setUploadState('uploading');
    try {
      await onUpload(file);
      setUploadState('idle');
    } catch {
      // onUpload (useCards().uploadCardImage) já dispara seu próprio alert()
      // de erro (padrão de mutação do projeto) — aqui só cuidamos do estado
      // visual próprio do componente, pra nunca deixar o quadrado pulsante
      // travado silenciosamente.
      setUploadState('error');
      setTimeout(() => setUploadState('idle'), ERROR_DISPLAY_MS);
    }
  }, [onUpload]);

  const handleDelete = useCallback((e, imageId) => {
    e.stopPropagation();
    onDelete(imageId);
  }, [onDelete]);

  return (
    <div>
      <div className="img-strip" style={styles.strip} onClick={(e) => e.stopPropagation()}>
        {list.map((img) => (
          <div key={img.id} style={styles.thumbWrap(size)}>
            {brokenIds.has(img.id) ? (
              <div
                style={styles.thumbPlaceholder(size)}
                onClick={() => setFullscreenImage(img)}
                data-testid={`image-thumb-broken-${img.id}`}
              >
                <PhotoIcon size={Math.round(size * 0.44)} />
              </div>
            ) : (
              <img
                src={img.url}
                alt=""
                style={styles.thumbImg(size)}
                onClick={() => setFullscreenImage(img)}
                onError={() => markBroken(img.id)}
                data-testid={`image-thumb-${img.id}`}
              />
            )}
            <button
              type="button"
              aria-label="Excluir imagem"
              style={styles.deleteBtn}
              onClick={(e) => handleDelete(e, img.id)}
            >
              ×
            </button>
          </div>
        ))}

        {!atLimit && uploadState === 'uploading' && (
          <div
            data-testid="image-attachments-uploading"
            style={styles.uploadingSlot(size)}
          />
        )}

        {showAddButton && !atLimit && uploadState !== 'uploading' && (
          <button
            type="button"
            aria-label="Escolher imagem"
            style={styles.addSlot(size, uploadState === 'error')}
            onClick={handleAddClick}
          >
            +
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          data-testid={`image-attachments-input-${cardId}`}
        />
      </div>

      {atLimit && (
        <div style={styles.limitNote} data-testid="image-attachments-limit-note">
          {MAX_IMAGES}/{MAX_IMAGES} imagens
        </div>
      )}

      {uploadState === 'error' && (
        <div role="alert" style={styles.errorNote} data-testid="image-attachments-error">
          Falha ao enviar imagem.
        </div>
      )}

      {fullscreenImage && (
        <div
          style={styles.overlay}
          onClick={() => setFullscreenImage(null)}
          data-testid="image-attachments-overlay"
        >
          <button
            type="button"
            aria-label="Fechar"
            style={styles.overlayClose}
            onClick={(e) => { e.stopPropagation(); setFullscreenImage(null); }}
          >
            ✕
          </button>
          {brokenIds.has(fullscreenImage.id) ? (
            <PhotoIcon size={64} />
          ) : (
            <img
              src={fullscreenImage.url}
              alt=""
              style={styles.overlayImg}
              onClick={(e) => e.stopPropagation()}
              onError={() => markBroken(fullscreenImage.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
