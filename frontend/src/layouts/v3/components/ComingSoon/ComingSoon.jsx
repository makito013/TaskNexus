import { useEffect } from 'react'
import Chip from '../Chip/Chip.jsx'
import Panel from '../Panel/Panel.jsx'
import Pet from '../Pet/Pet.jsx'
import './ComingSoon.css'

// Screen of a module that has no real screen yet. Focus on the heading is
// moved by the shell (AppV3) when the module changes.
//   module: an entry of modules.js (label, pet, comingSoonCopy)
export default function ComingSoon({ module }) {
  useEffect(() => {
    document.title = `${module.label} · TaskNexus`
  }, [module])

  return (
    <div className="v3-coming-soon">
      <h1 tabIndex={-1} className="v3-type-title-lg v3-coming-soon__title">
        {module.label}
      </h1>
      <Panel className="v3-coming-soon__panel">
        <Pet pet={module.pet} state="sleeping" size={96} decorative />
        <Chip tone="state" accent="soon">Em breve</Chip>
        <p className="v3-type-body-lg v3-coming-soon__text">{module.comingSoonCopy}</p>
      </Panel>
    </div>
  )
}
