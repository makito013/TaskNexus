import { useEffect, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import ArtifactCard, { ArtifactCardSkeleton } from './ArtifactCard.jsx'

const SKELETONS = 6
const BUCKET_LABEL = { unassigned: 'Sem workspace', unknown: 'Projeto não encontrado', unregistered: 'Não cadastrada' }

function Grid({ items, activeId, onOpen, onMenu }) {
  return (
    <ul className="v3-artifacts-grid">
      {items.map((artifact) => (
        <li key={artifact.artifact_id}>
          <ArtifactCard artifact={artifact} active={activeId === artifact.artifact_id} onOpen={onOpen} onMenu={onMenu} />
        </li>
      ))}
    </ul>
  )
}

// The count that is said aloud, and only when it CHANGES after the first answer (a list refreshing in the
// background says nothing).
function useCountAnnouncement(count, ready) {
  const [text, setText] = useState('')
  const last = useRef(null)
  useEffect(() => {
    if (!ready) return
    if (last.current !== null && last.current !== count) setText(count === 1 ? '1 artefato.' : `${count} artefatos.`)
    last.current = count
  }, [count, ready])
  return text
}

// What is under the bar: skeletons, the error of the first read, the two empty states, the groups
// ("WORKSPACE / PROJETO · N") or the single grid of a chosen project, and the footer.
//   artifacts     the list as read (null until the first answer)
//   error         the message of the last failed read (kept apart from a list that is already on screen)
//   groups        [{ key, label, bucket, archived, items }] or null for one grid
//   items         the visible artifacts, in order (the single grid, and the count)
//   scopedCount   how many artifacts the scope has, filters aside (tells "empty" from "filtered out")
//   filtering     a type or a search is on
export default function ArtifactGallery({
  artifacts,
  error,
  groups,
  items,
  scopedCount,
  filtering,
  activeId,
  canImport,
  onOpen,
  onMenu,
  onRetry,
  onClearFilters,
  onImport,
  galleryRef,
}) {
  const announcement = useCountAnnouncement(items.length, artifacts !== null)
  let body
  if (artifacts === null && error) {
    body = (
      <Panel notice="fin" role="alert">
        <b>Não consegui carregar os artefatos.</b>{' '}
        <Button variant="secondary" size="sm" onClick={onRetry}>Tentar de novo</Button>
      </Panel>
    )
  } else if (artifacts === null) {
    body = (
      <>
        <span className="v3-projects__sr-only" role="status">Carregando os artefatos…</span>
        <div className="v3-artifacts-grid" aria-hidden="true">
          {Array.from({ length: SKELETONS }, (_, index) => <ArtifactCardSkeleton key={index} />)}
        </div>
      </>
    )
  } else if (items.length === 0 && filtering && scopedCount > 0) {
    body = (
      <div className="v3-state-box" data-testid="artifacts-empty-filter">
        <p className="v3-type-body v3-state-box__text">Nenhum artefato com esses filtros.</p>
        <Button variant="text" onClick={onClearFilters}>Limpar filtros</Button>
      </div>
    )
  } else if (items.length === 0) {
    body = (
      <div className="v3-state-box v3-artifacts-empty" data-testid="artifacts-empty">
        <DialogIcon name="folder" size={28} />
        <h3 className="v3-type-title-md v3-state-box__title">Nenhum artefato ainda</h3>
        <p className="v3-type-body v3-state-box__text">Os arquivos que o agente publicar aparecem aqui.</p>
        {canImport ? <Button variant="primary" onClick={onImport}>Importar do projeto</Button> : null}
      </div>
    )
  } else if (groups) {
    body = groups.map((group) => (
      <section key={group.key} className="v3-artifacts-group" aria-label={`${group.label}, ${group.items.length}`}>
        <h3 className="v3-artifacts-group__label v3-type-eyebrow">
          <span className="v3-type-mono-sm">{group.label} · {group.items.length}</span>
          {group.bucket ? <Chip>{BUCKET_LABEL[group.bucket]}</Chip> : null}
          {group.archived ? <Chip>arquivado</Chip> : null}
        </h3>
        <Grid items={group.items} activeId={activeId} onOpen={onOpen} onMenu={onMenu} />
      </section>
    ))
  } else {
    body = <Grid items={items} activeId={activeId} onOpen={onOpen} onMenu={onMenu} />
  }

  return (
    <div
      ref={galleryRef}
      className="v3-artifacts-gallery"
      role="region"
      aria-label="Galeria de artefatos"
      tabIndex={-1}
      aria-busy={artifacts === null && !error ? 'true' : undefined}
    >
      {body}
      {artifacts !== null && items.length > 0 ? (
        <div className="v3-artifacts-footer">
          <Button
            variant="secondary"
            aria-disabled={canImport ? undefined : 'true'}
            onClick={() => { if (canImport) onImport() }}
          >
            ＋ Importar do projeto…
          </Button>
          <span className="v3-type-caption v3-artifacts-footer__hint">
            Importe arquivos .md, .html e .pdf que o agente criou no projeto.
          </span>
        </div>
      ) : null}
      <span className="v3-projects__sr-only" aria-live="polite">{announcement}</span>
    </div>
  )
}
