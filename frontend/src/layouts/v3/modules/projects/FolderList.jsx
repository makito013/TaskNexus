import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { LOCKED_MISSING_HINT, errorsOf } from './folderRules.js'

export const HISTORY_CHIP = 'mantém o histórico da V2'

// The folders of a project. Native radios ("Principal", name="primary") give the
// arrow keys between the ENABLED ones for free; the rows are list items of a
// radiogroup labelled by the "Pastas" label of the dialog.
//   locked row   - the primary of a legacy-keyed project: its radio and "Remover"
//                  are aria-disabled (still focusable) and described by the lock
//                  note; every other radio is disabled while it exists
//   row with an error - cannot be the primary until fixed or removed
//   adoptableFor - id of the workspace the project is being created in; the primary
//                  row of a folder the V2 already knows there says it keeps the history
export default function FolderList({
  folders,
  labelId = 'folders-lbl',
  lockNoteId = 'lock-note',
  idPrefix = 'fp',
  adoptableFor = null,
  onPrimaryChange,
  onRemove,
}) {
  const lockedRow = folders.some((folder) => folder.locked)
  return (
    <ul className="v3-folders" role="radiogroup" aria-labelledby={labelId}>
      {folders.map((folder, index) => {
        const errors = errorsOf(folder)
        const pathId = `${idPrefix}-${index}`
        const warns = folder.check?.warns || []
        const keepsHistory = folder.isPrimary && adoptableFor != null && folder.adoptableWorkspaceId === adoptableFor
        const radioDisabled = (lockedRow && !folder.locked) || errors.length > 0
        return (
          <li key={folder.uid} className={`v3-folder${errors.length > 0 ? ' v3-folder--err' : ''}`}>
            <div className="v3-folder__row">
              <DialogIcon name="folder" />
              <span className="v3-folder__path" id={pathId}>{folder.path}</span>
              {folder.locked && (
                <Chip className="v3-folder__lock"><DialogIcon name="lock" size={14} />travada</Chip>
              )}
              {folder.saved && !folder.exists && <Chip tone="state" accent="danger">pasta não encontrada</Chip>}
              <label className="v3-folder__radio">
                <input
                  type="radio"
                  name="primary"
                  checked={folder.isPrimary}
                  disabled={radioDisabled}
                  aria-disabled={folder.locked ? 'true' : undefined}
                  aria-describedby={folder.locked ? `${pathId} ${lockNoteId}` : pathId}
                  onChange={() => onPrimaryChange(index)}
                />
                Principal
              </label>
              <Button
                size="sm"
                aria-label={`Remover pasta ${folder.path}`}
                {...(folder.locked
                  ? { 'aria-disabled': 'true', 'aria-describedby': lockNoteId }
                  : { onClick: () => onRemove(index) })}
              >
                Remover
              </Button>
            </div>
            {errors.map((error) => (
              <div key={`${error.code}-${error.message}`} className="v3-msg v3-msg--err" role="alert" data-code={error.code}>
                <DialogIcon name="alert" size={16} />
                <span><b>Erro:</b> {error.message}</span>
              </div>
            ))}
            {folder.locked && !folder.exists && (
              <div className="v3-msg v3-msg--info" data-testid="locked-missing-hint">
                <DialogIcon name="info" size={16} />
                <span>{LOCKED_MISSING_HINT}</span>
              </div>
            )}
            {(warns.length > 0 || keepsHistory) && (
              <div className="v3-folder__chips">
                {warns.map((warn) => (
                  <Chip key={warn.text} className="v3-folder-chip v3-folder-chip--warn">
                    <DialogIcon name="alert" size={14} />{warn.text}
                  </Chip>
                ))}
                {keepsHistory && <Chip className="v3-folder-chip v3-folder-chip--ok">{HISTORY_CHIP}</Chip>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
