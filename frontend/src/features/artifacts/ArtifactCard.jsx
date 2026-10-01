// frontend/src/features/artifacts/ArtifactCard.jsx
// Fase A (07-planejamento-artefatos.md, 7.2 item 3): o cartão de um artefato —
// selo do tipo, título, caminho, trecho e rodapé "quem · quando · tamanho".
// Arquivo sumido: borda tracejada + selo "arquivo não encontrado".
//
// Tocar abre no painel (`onOpen`). O menu de ações abre pelo ⋯ ou por TOQUE
// LONGO (iPad: é o gesto que se espera para "mais opções") e, no mouse, pelo
// botão direito. O cartão é um `div role=button` e não um <button> porque o ⋯
// é outro botão dentro dele, e botão dentro de botão não é HTML válido.
import { useRef } from 'react';
import { KIND_LABEL, displayPath, footerText } from './artifactModel.js';

const LONG_PRESS_MS = 500;
// Mais que isso de movimento = o dedo está rolando a lista, não segurando.
const MOVE_TOLERANCE_PX = 10;

/** Toque longo sem biblioteca: Pointer Events (iPad com dedo e Pencil, mouse).
 * Depois de disparar, o `click` que o navegador manda ao soltar é ignorado —
 * senão o cartão abriria o arquivo por baixo do menu. */
function useLongPress(onLongPress) {
  const timer = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    firedRef: fired,
    handlers: {
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        fired.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        const target = event.currentTarget;
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLongPress(target);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        if (!timer.current || !start.current) return;
        const dx = Math.abs(event.clientX - start.current.x);
        const dy = Math.abs(event.clientY - start.current.y);
        if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  };
}

/**
 * @param {object} props
 * @param {object} props.artifact
 * @param {boolean} [props.active]           aberto no painel agora
 * @param {string|null} [props.baseProjectId] projeto da grade (mostra o subprojeto no caminho)
 * @param {(artifact: object) => void} props.onOpen
 * @param {(artifact: object, anchor: Element) => void} props.onMenu
 */
export function ArtifactCard({ artifact, active = false, baseProjectId = null, onOpen, onMenu }) {
  const missing = artifact.exists === false;
  const kindLabel = KIND_LABEL[artifact.kind] || String(artifact.kind || '').toUpperCase();
  const path = displayPath(artifact, baseProjectId);
  const { firedRef, handlers } = useLongPress((target) => onMenu(artifact, target));

  const className = [
    'af-card',
    active ? 'af-card--active' : '',
    missing ? 'af-card--missing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      data-testid={`artifact-card-${artifact.artifact_id}`}
      data-missing={missing ? 'true' : undefined}
      aria-label={`${artifact.title} (${kindLabel})${missing ? ', arquivo não encontrado' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        if (firedRef.current) {
          firedRef.current = false;
          return;
        }
        onOpen(artifact);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(artifact);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(artifact, event.currentTarget);
      }}
      {...handlers}
    >
      <div className="af-card-head">
        <span className={`af-badge af-badge--${artifact.kind}`}>{kindLabel}</span>
      </div>
      <div className="af-card-title">{artifact.title}</div>
      <div className="af-card-path" title={artifact.path}>{path}</div>
      {missing ? (
        <span className="af-missing">arquivo não encontrado</span>
      ) : (
        artifact.excerpt && <div className="af-card-excerpt">{artifact.excerpt}</div>
      )}
      <div className="af-card-foot">{footerText(artifact)}</div>
      <button
        type="button"
        className="af-card-more"
        aria-label={`Ações de ${artifact.title}`}
        aria-haspopup="menu"
        title="Mais ações"
        // O ⋯ não pode disparar o toque longo nem o clique do cartão.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onMenu(artifact, event.currentTarget);
        }}
      >
        ⋯
      </button>
    </div>
  );
}

/** Cartão esqueleto (carregando). */
export function ArtifactCardSkeleton() {
  return (
    <div className="af-card af-card--skeleton" aria-hidden="true">
      <span /><span /><span /><span /><span />
    </div>
  );
}
