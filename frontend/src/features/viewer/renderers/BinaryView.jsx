// frontend/src/features/viewer/renderers/BinaryView.jsx
// Fase V-2 (6.2, estado "Binário ou > 1 MB"): sem preview — nome, tipo,
// tamanho e o Baixar em destaque. Também cobre `kind: video`: o backend ainda
// não responde `Range` (6.10.5) e o <video> do Safari exige, então tocar no
// painel falharia em silêncio.
import { fileUrl } from '../viewerApi.js';
import { basenameOf, formatBytes } from '../viewerPaths.js';

const REASONS = {
  video: 'O visualizador ainda não toca vídeo. Baixe para assistir.',
  large: 'O arquivo é grande demais para mostrar aqui.',
  binary: 'Este tipo de arquivo não tem visualização.',
};

export function BinaryView({ item, content, reason = 'binary', onShowAnyway }) {
  const name = content?.name || basenameOf(item.path);
  const details = [content?.mime, Number.isFinite(content?.size) ? formatBytes(content.size) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="vw-center">
      <div className="vw-state" data-testid="viewer-binary">
        <div className="vw-state-title" style={{ fontSize: '28px', marginBottom: '10px' }} aria-hidden="true">
          {reason === 'video' ? '🎬' : '📦'}
        </div>
        <div className="vw-state-title">{name}</div>
        {details && <div>{details}</div>}
        <div style={{ marginTop: '8px' }}>{REASONS[reason] || REASONS.binary}</div>
        <div className="vw-state-actions">
          <a className="vw-btn vw-btn--primary" href={fileUrl(item, item.path, { download: true })} download={name}>
            ⤓ Baixar
          </a>
          {onShowAnyway && (
            <button type="button" className="vw-btn" onClick={onShowAnyway}>
              Mostrar o começo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
