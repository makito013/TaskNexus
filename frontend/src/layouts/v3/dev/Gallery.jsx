import { useEffect } from 'react'
import Button from '../components/Button/Button.jsx'
import Chip from '../components/Chip/Chip.jsx'
import Panel from '../components/Panel/Panel.jsx'
import Pet from '../components/Pet/Pet.jsx'
import { PET_IDS, PET_NAMES } from '../components/Pet/petShapes.js'
import { PET_STATES } from '../components/Pet/petStates.js'
import './Gallery.css'

// DEV-ONLY component gallery, reachable at /dev/gallery in the v3 build and not
// listed in the module rail. The only way to eyeball the pets and the atoms in a
// real browser (SMIL is invisible to jsdom). To be removed after one visual
// check before the final PR of the v3 work.
export default function Gallery() {
  useEffect(() => {
    document.title = 'Galeria · TaskNexus'
  }, [])

  return (
    <div className="v3-gallery">
      <header className="v3-gallery__header">
        <h1 className="v3-type-title-lg">Galeria de componentes (dev)</h1>
      </header>

      <section aria-labelledby="gallery-pets">
        <h2 id="gallery-pets" className="v3-type-title-sm">Pets</h2>
        <div className="v3-gallery__pets">
          {PET_IDS.map((pet) => (
            <div key={pet} className="v3-gallery__pet-row">
              <span className="v3-type-eyebrow">{PET_NAMES[pet]}</span>
              {PET_STATES.map((state) => (
                <figure key={state} className="v3-gallery__pet">
                  <Pet pet={pet} state={state} />
                  <figcaption className="v3-type-caption">{state}</figcaption>
                </figure>
              ))}
              <Pet pet={pet} size="side" />
              <Pet pet={pet} size="nav" decorative />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="gallery-atoms">
        <h2 id="gallery-atoms" className="v3-type-title-sm">Botões e chips</h2>
        <div className="v3-gallery__row">
          <Button variant="primary">Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="text">Texto</Button>
          <Button variant="module">Módulo (padrão)</Button>
          <Button variant="module" module="tiq">Tiq</Button>
          <Button variant="module" module="bit">Bit</Button>
          <Button variant="module" module="fin">Fin</Button>
          <Button variant="module" module="navi">Navi</Button>
          <Button size="sm">Pequeno</Button>
          <Button aria-busy="true">Salvando…</Button>
        </div>
        <div className="v3-gallery__row">
          <Chip tone="id">#132</Chip>
          <Chip tone="badge" kind="bug">bug</Chip>
          <Chip tone="badge" kind="hotfix">hotfix</Chip>
          <Chip tone="badge" kind="story">história</Chip>
          <Chip tone="state" accent="tiq">Pendente</Chip>
          <Chip tone="state" accent="navi">Concluída</Chip>
          <Chip tone="state" accent="danger">Atrasada</Chip>
          <Chip tone="state" accent="soon">Em breve</Chip>
          <Chip>Validação</Chip>
        </div>
        <div className="v3-gallery__row">
          <Panel>Painel</Panel>
          <Panel notice="tiq">Nota do Tiq</Panel>
          <Panel notice="fin">Aviso do Fin</Panel>
        </div>
      </section>
    </div>
  )
}
