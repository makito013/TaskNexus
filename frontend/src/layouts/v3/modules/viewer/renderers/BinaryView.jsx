import { fileUrl } from '../../../../../services/viewerApi.js'
import { basenameOf, formatBytes } from '../../../../../utils/viewerPaths.js'
import Button from '../../../components/Button/Button.jsx'

const REASONS = {
  video: 'O visualizador ainda não toca vídeo. Baixe para assistir.',
  large: 'Esse arquivo é grande ou não tem pré-visualização.',
  binary: 'Esse arquivo é grande ou não tem pré-visualização.',
}

// No preview: name, type, size and a prominent "Baixar". "Mostrar o começo" exists only for a cut text file and
// only when asked for.
export default function BinaryView({ item, content, reason = 'binary', onShowAnyway }) {
  const name = content?.name || basenameOf(item.path)
  const details = [content?.mime, Number.isFinite(content?.size) ? formatBytes(content.size) : null].filter(Boolean).join(' · ')
  return (
    <div className="v3-viewer-card" data-testid="viewer-binary">
      <h3 className="v3-viewer-card__title v3-type-mono">{name}</h3>
      {details ? <p className="v3-viewer-card__details v3-type-mono-sm">{details}</p> : null}
      <p className="v3-type-body-sm">{REASONS[reason] || REASONS.binary}</p>
      <div className="v3-viewer-card__actions">
        <a className="v3-button v3-button--primary v3-button--md" href={fileUrl(item, item.path, { download: true })} download={name}>Baixar</a>
        {onShowAnyway ? <Button variant="secondary" onClick={onShowAnyway}>Mostrar o começo</Button> : null}
      </div>
    </div>
  )
}
