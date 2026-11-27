import { useState } from 'react'
import { fileUrl } from '../../../../../services/viewerApi.js'
import { basenameOf } from '../../../../../utils/viewerPaths.js'
import Button from '../../../components/Button/Button.jsx'

// An image of the project. SVG goes through <img> only: it never runs the file's script.
export default function ImageView({ item }) {
  const [actualSize, setActualSize] = useState(false)
  const [failed, setFailed] = useState(false)
  const name = basenameOf(item.path)

  if (failed) {
    return (
      <div className="v3-viewer-card" role="alert">
        <h3 className="v3-viewer-card__title v3-type-mono">{name}</h3>
        <p className="v3-type-body-sm">Não consegui carregar a imagem.</p>
        <div className="v3-viewer-card__actions">
          <a className="v3-button v3-button--primary v3-button--md" href={fileUrl(item, item.path, { download: true })} download={name}>Baixar</a>
        </div>
      </div>
    )
  }
  return (
    <div className="v3-viewer-image" data-testid="viewer-image">
      <div className="v3-viewer-image__bar">
        <Button variant="text" size="sm" aria-pressed={actualSize} onClick={() => setActualSize((value) => !value)}>
          {actualSize ? 'Caber na tela' : 'Tamanho real'}
        </Button>
      </div>
      <div className={`v3-viewer-image__frame${actualSize ? ' v3-viewer-image__frame--actual' : ''}`}>
        <img
          src={fileUrl(item, item.path, { version: item.updated_at })}
          alt={item.title || name}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  )
}
