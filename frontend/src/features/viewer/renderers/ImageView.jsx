// frontend/src/features/viewer/renderers/ImageView.jsx
// Fase V-2 (6.2): imagem do projeto (png, jpg, svg…). Toque alterna entre
// "caber no painel" e "tamanho real" (com rolagem dentro do painel) — a pinça
// do iPad continua funcionando sobre a página. SVG vem pelo <img>, que nunca
// executa script do arquivo (e o backend ainda manda CSP sandbox).
import { useState } from 'react';
import { fileUrl } from '../viewerApi.js';
import { basenameOf } from '../viewerPaths.js';

export function ImageView({ item }) {
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = basenameOf(item.path);

  if (failed) {
    return (
      <div className="vw-center">
        <div className="vw-state" role="status">
          <div className="vw-state-title">Não consegui carregar a imagem</div>
          <a className="vw-btn" href={fileUrl(item, item.path, { download: true })} download={name}>⤓ Baixar</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`vw-image-wrap${actualSize ? ' vw-image-wrap--actual' : ''}`} data-testid="viewer-image">
      <img
        src={fileUrl(item, item.path, { version: item.updated_at })}
        alt={item.title || name}
        title={actualSize ? 'Toque para caber no painel' : 'Toque para ver no tamanho real'}
        onClick={() => setActualSize((v) => !v)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
