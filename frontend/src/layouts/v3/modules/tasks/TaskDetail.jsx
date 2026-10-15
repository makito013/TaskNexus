import { useMemo } from 'react'
import { CARD_TIPO_LABELS } from '../../../../utils/cardMeta.js'
import { renderMarkdown } from '../../../../utils/markdown.js'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { demoteHeadings } from './demoteHeadings.js'
import { dueLongDate, dueRelative } from './dueLabels.js'
import { projectLabel } from './taskItems.js'

const CHIP_KIND = { bug: 'bug', hotfix: 'hotfix', historia: 'story' }

function stateChip(item) {
  if (item.done) return { accent: 'navi', label: 'Concluída' }
  if (item.overdue) return { accent: 'danger', label: 'Atrasada' }
  return { accent: 'tiq', label: 'Pendente' }
}

// Body of the "Detalhe da tarefa" aside. Validation tasks get Concluir/Reabrir;
// cards are read-only (they belong to the board).
//   saving:        this item has a complete/reopen in flight
//   mutationError: the last complete/reopen failure ({ id, error }); the notice
//                  shows only on the item it came from
export default function TaskDetail({ item, today, saving, mutationError, onComplete, onReopen }) {
  const chip = stateChip(item)
  const actionable = item.source === 'validation'

  // renderMarkdown sanitizes with DOMPurify (same path as the v2 detail modal).
  const descriptionHtml = useMemo(
    () => (item.descriptionMarkdown ? demoteHeadings(renderMarkdown(item.descriptionMarkdown)) : ''),
    [item.descriptionMarkdown],
  )

  return (
    <Panel className="v3-task-detail">
      <div className="v3-task-detail__chips">
        <Chip tone="state" accent={chip.accent}>{chip.label}</Chip>
        {actionable ? (
          <Chip tone="neutral">Validação</Chip>
        ) : (
          <>
            <Chip tone="id">#{item.cardId}</Chip>
            {item.kind && <Chip tone="badge" kind={CHIP_KIND[item.kind]}>{CARD_TIPO_LABELS[item.kind]}</Chip>}
          </>
        )}
      </div>

      <h2 className="v3-type-title-md v3-task-detail__title">{item.title}</h2>

      {item.due && (
        <div className="v3-task-detail__due">
          <p className="v3-type-body-sm v3-task-detail__date">{dueLongDate(item.due, today)}</p>
          {!item.done && (
            <p className="v3-type-label v3-task-detail__relative">{dueRelative(item.due, today)}</p>
          )}
        </div>
      )}

      {projectLabel(item) && (
        <p className="v3-type-caption v3-task-detail__project">Projeto: {projectLabel(item)}</p>
      )}

      {descriptionHtml ? (
        <div className="v3-prose v3-task-detail__description" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
      ) : (
        <p className="v3-type-body-sm v3-task-detail__empty">Sem descrição.</p>
      )}

      {!actionable && (
        <Panel notice="tiq">Esse card vem do board. Aqui eu só mostro; pra mexer, use o layout atual.</Panel>
      )}

      {actionable && mutationError?.id === item.id && (
        <Panel notice="fin" role="status">Não consegui salvar. Tenta de novo?</Panel>
      )}

      {actionable && (
        <div className="v3-task-detail__footer">
          {item.done && !saving ? (
            <Button variant="secondary" className="v3-task-detail__action" onClick={() => onReopen(item)}>
              Reabrir
            </Button>
          ) : (
            <Button
              variant="module"
              module="tiq"
              className="v3-task-detail__action"
              aria-busy={saving || undefined}
              aria-disabled={saving || undefined}
              onClick={() => { if (!saving) onComplete(item) }}
            >
              {saving ? 'Salvando…' : 'Concluir'}
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}
