import Panel from '../../components/Panel/Panel.jsx'
import './Artifacts.css'

// Aba "Artefatos" of Projetos. Provisional: the tab is selectable and says what
// is coming; nothing is read or published until the gallery arrives.
export default function ArtifactsTab() {
  return (
    <div className="v3-artifacts">
      <h2 className="v3-artifacts__heading">Artefatos</h2>
      <Panel notice="tiq">Os artefatos chegam em seguida.</Panel>
    </div>
  )
}
