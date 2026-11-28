import { useId } from 'react'
import { CARD_PRIORIDADE_LABELS, CARD_PRIORIDADES, CARD_TIPOS, CARD_TIPO_LABELS } from '../../../../utils/cardMeta.js'
import { DEFAULT_BOARD_VIEW, FILTER_NONE, PRAZO_FILTER_OPTIONS } from '../../../../utils/boardView.js'

// Labels of the V3 toolbar (05 section 2.1). The V2 labels in utils/boardView.js
// belong to the V2 and are left alone.
export const SORT_CHOICES = [
  { value: 'manual', label: 'Ordem manual' },
  { value: 'prioridade', label: 'Ordenar: Prioridade' },
  { value: 'prazo', label: 'Ordenar: Prazo' },
  { value: 'criado_em', label: 'Ordenar: Criação' },
  { value: 'atualizado_em', label: 'Ordenar: Atualização' },
  { value: 'titulo', label: 'Ordenar: Título' },
]

const PRIORITY_CHOICES = [
  { value: '', label: 'Todas as prioridades' },
  ...[...CARD_PRIORIDADES].reverse().map((value) => ({ value, label: CARD_PRIORIDADE_LABELS[value] })),
  { value: FILTER_NONE, label: 'Sem prioridade' },
]
const TYPE_CHOICES = [
  { value: '', label: 'Todos os tipos' },
  ...CARD_TIPOS.map((value) => ({ value, label: CARD_TIPO_LABELS[value] })),
  { value: FILTER_NONE, label: 'Sem tipo' },
]
const DUE_CHOICES = [{ value: '', label: 'Qualquer prazo' }, ...PRAZO_FILTER_OPTIONS]

function Select({ label, value, defaultValue = '', choices, disabled = false, onChange }) {
  const id = useId()
  const active = value !== defaultValue
  return (
    <>
      <label htmlFor={id} className="v3-projects__sr-only">{label}</label>
      <select
        id={id}
        className={`v3-board-select v3-type-body-sm${active ? ' v3-board-select--active' : ''}`}
        title={active ? `${label} (filtrado)` : label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </>
  )
}

// The selects of the board toolbar. `view` holds priority, type, due and sort;
// the project select is separate because its options come from the workspace.
export default function BoardFilters({ view, onViewChange, projectOptions, projectKey, onProjectChange, projectDisabled }) {
  const change = (key) => (value) => onViewChange({ ...view, [key]: value })
  return (
    <>
      <Select label="Projeto" value={projectKey} choices={projectOptions} disabled={projectDisabled} onChange={onProjectChange} />
      <Select label="Prioridade" value={view.prioridade} choices={PRIORITY_CHOICES} onChange={change('prioridade')} />
      <Select label="Tipo" value={view.tipo} choices={TYPE_CHOICES} onChange={change('tipo')} />
      <Select label="Prazo" value={view.prazo} choices={DUE_CHOICES} onChange={change('prazo')} />
      <Select
        label="Ordenar"
        value={view.sort}
        defaultValue={DEFAULT_BOARD_VIEW.sort}
        choices={SORT_CHOICES}
        onChange={change('sort')}
      />
    </>
  )
}
