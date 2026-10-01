// frontend/src/features/viewer/ViewerToast.jsx
// Fase V-2 (6.1, "Abrir sozinho"): o aviso curto "claude abriu plano.md · Ver"
// quando o agente abre um arquivo com a conversa fora de vista (outra
// conversa, Board, Tarefas…), e as mensagens de erro de abrir um link
// ("Arquivo não encontrado: …"). Some sozinho; nunca rouba o foco.
import { useEffect } from 'react';
import { useViewer } from './ViewerContext.jsx';

const DISMISS_MS = 6000;

const styles = {
  dock: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 'calc(var(--v2-safe-bottom, 0px) + 16px)',
    zIndex: 57,
    display: 'flex',
    justifyContent: 'center',
    padding: '0 16px',
    // A faixa inteira não pode bloquear toques no app; só o cartão.
    pointerEvents: 'none',
  },
};

export function ViewerToast() {
  const viewer = useViewer();
  const toast = viewer?.toast;
  const dismiss = viewer?.dismissToast;

  useEffect(() => {
    if (!toast || !dismiss) return undefined;
    const timer = setTimeout(() => dismiss(toast.id), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  const isError = toast.kind === 'error';

  return (
    <div style={styles.dock}>
      <div
        className={`vw-toast${isError ? ' vw-toast--error' : ''}`}
        style={{ pointerEvents: 'auto' }}
        role={isError ? 'alert' : 'status'}
        data-testid="viewer-toast"
      >
        <span className="vw-toast-text">{toast.text}</span>
        {toast.kind === 'open' && (
          <button type="button" className="vw-btn vw-btn--quiet" style={{ height: '36px', color: 'var(--v2-accent-strong)' }} onClick={() => viewer.revealToast(toast)}>
            Ver
          </button>
        )}
        <button
          type="button"
          className="vw-btn vw-btn--icon vw-btn--quiet"
          aria-label="Fechar aviso"
          onClick={() => dismiss(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
