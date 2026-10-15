import { CARD_TIPO_LABELS } from '../../../../utils/cardMeta.js'
import Chip from '../../components/Chip/Chip.jsx'
import { dueRowLabel } from './dueLabels.js'
import { localIsoDate, projectLabel } from './taskItems.js'

// Chip kind of the card tipo ("historia" is the persisted PT-BR value).
const CHIP_KIND = { bug: 'bug', hotfix: 'hotfix', historia: 'story' }

// One row: [control][select button: title + project][chips][due].
// The checkbox is a sibling of the select button (no nested interactives) and
// exists only for validation tasks, which are the only actionable items.
export default function TaskRow({ item, today, selected, saving, onSelect, onToggle }) {
  const actionable = item.source === 'validation'
  const dueToday = !item.done && item.due !== null && item.due === localIsoDate(today)
  const dueAlert = item.overdue || dueToday
  const dueText = dueRowLabel(item.due, { done: item.done, overdue: item.overdue, today })

  const classes = [
    'v3-task-row',
    selected ? 'v3-task-row--selected' : '',
    item.done ? 'v3-task-row--done' : '',
  ].filter(Boolean).join(' ')

  return (
    <li className={classes} aria-busy={saving || undefined}>
      {actionable ? (
        <label className="v3-task-row__check">
          <input
            type="checkbox"
            checked={item.done}
            aria-label={`${item.done ? 'Reabrir' : 'Concluir'} ${item.title}`}
            onChange={() => onToggle(item)}
          />
        </label>
      ) : (
        <span className="v3-task-row__spacer" aria-hidden="true" />
      )}

      <button
        type="button"
        className="v3-task-row__main"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(item.id)}
      >
        <span className="v3-type-body v3-task-row__title">{item.title}</span>
        {projectLabel(item) && (
          <span className="v3-type-caption v3-task-row__project">{projectLabel(item)}</span>
        )}
      </button>

      <span className="v3-task-row__chips">
        {actionable ? (
          <Chip tone="neutral">Validação</Chip>
        ) : (
          <>
            <Chip tone="id">#{item.cardId}</Chip>
            {item.kind && <Chip tone="badge" kind={CHIP_KIND[item.kind]}>{CARD_TIPO_LABELS[item.kind]}</Chip>}
          </>
        )}
      </span>

      <span
        className={`v3-type-mono-sm v3-task-row__due${dueAlert ? ' v3-task-row__due--alert' : ''}${item.due ? '' : ' v3-task-row__due--none'}`}
      >
        {dueText}
      </span>
    </li>
  )
}
