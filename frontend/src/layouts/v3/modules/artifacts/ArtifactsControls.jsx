import { useId, useRef } from 'react'
import { ORDENS, TIPO_CHIPS } from '../../../../utils/artifactModel.js'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'

// The bar above the gallery: the project select, the type chips (one radio group), the search, the order,
// the "Visualizador" toggle with the tabs left open, and "Importar do projeto…".
//   projectOptions / projectKey / onProjectChange / projectDisabled   the select ("depois do filtro do topo")
//   tipo / onTipoChange        'todos' | 'markdown' | 'html' | 'pdf'
//   query / onQueryChange      the search text
//   order / onOrderChange      'recentes' | 'nome'
//   stale                      the last read failed and the list on screen is the last good one
//   openTabs / panelOpen / onTogglePanel   the tabs of the artifacts scope (null openTabs = no viewer)
//   canImport / importHint / onImport
export default function ArtifactsControls({
  projectOptions,
  projectKey,
  onProjectChange,
  projectDisabled,
  tipo,
  onTipoChange,
  query,
  onQueryChange,
  order,
  onOrderChange,
  stale = false,
  openTabs = null,
  panelOpen = false,
  onTogglePanel,
  canImport,
  importHint,
  onImport,
}) {
  const ids = useId()
  const radiosRef = useRef(null)

  // A radio group walks with the arrows and selects as it goes.
  const onRadioKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (!(event.key in keys)) return
    event.preventDefault()
    const index = TIPO_CHIPS.findIndex((chip) => chip.id === tipo)
    const next = TIPO_CHIPS[(index + keys[event.key] + TIPO_CHIPS.length) % TIPO_CHIPS.length]
    onTipoChange(next.id)
    radiosRef.current?.querySelector(`[data-tipo="${next.id}"]`)?.focus()
  }

  return (
    <div role="group" aria-label="Filtros dos artefatos" className="v3-artifacts-controls">
      <label htmlFor={`${ids}-project`} className="v3-projects__sr-only">Projeto</label>
      <select
        id={`${ids}-project`}
        className={`v3-artifacts-select v3-type-body-sm${projectKey ? ' v3-artifacts-select--active' : ''}`}
        value={projectKey}
        disabled={projectDisabled}
        onChange={(event) => onProjectChange(event.target.value)}
      >
        {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      <div ref={radiosRef} role="radiogroup" aria-label="Tipo de arquivo" className="v3-artifacts-controls__types" onKeyDown={onRadioKeyDown}>
        {TIPO_CHIPS.map((chip) => {
          const checked = tipo === chip.id
          return (
            <button
              key={chip.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-tipo={chip.id}
              className={`v3-artifacts-type${checked ? ' v3-artifacts-type--active' : ''}`}
              onClick={() => onTipoChange(chip.id)}
            >
              {checked ? <span className="v3-artifacts-type__dot" aria-hidden="true" /> : null}
              {chip.label}
            </button>
          )
        })}
      </div>

      <div className="v3-artifacts-search">
        <DialogIcon name="search" size={16} />
        <input
          type="search"
          className="v3-input v3-artifacts-search__input"
          aria-label="Buscar artefatos"
          placeholder="Buscar por título ou caminho"
          value={query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <label htmlFor={`${ids}-order`} className="v3-projects__sr-only">Ordenar</label>
      <select
        id={`${ids}-order`}
        className="v3-artifacts-select v3-type-body-sm"
        value={order}
        onChange={(event) => onOrderChange(event.target.value)}
      >
        {ORDENS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>

      {stale ? <Chip tone="state" accent="fin" role="status">Sem atualizar agora</Chip> : null}

      <span className="v3-artifacts-controls__spacer" />

      {openTabs !== null && openTabs > 0 ? (
        <Button size="sm" variant="secondary" aria-pressed={panelOpen} onClick={onTogglePanel}>
          Visualizador
          <Chip className="v3-artifacts-controls__tabs">Abas abertas: {openTabs}</Chip>
        </Button>
      ) : null}
      <Button
        variant="secondary"
        aria-disabled={canImport ? undefined : 'true'}
        aria-describedby={canImport ? undefined : `${ids}-import-hint`}
        onClick={() => { if (canImport) onImport() }}
      >
        ＋ Importar do projeto…
      </Button>
      {canImport ? null : <span id={`${ids}-import-hint`} className="v3-projects__sr-only">{importHint}</span>}
    </div>
  )
}
