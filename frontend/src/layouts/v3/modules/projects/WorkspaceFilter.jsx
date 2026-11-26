// Toolbar filters: workspace select plus the two checkboxes. Controlled; the
// state lives in ProjectsScreen and is applied on the view model (no request).
// showOnlyWaiting is false on the Board and Artefatos tabs: "who waits for you" is
// about agents.
export default function WorkspaceFilter({
  options,
  workspaceKey,
  onWorkspaceChange,
  onlyWaiting,
  onOnlyWaitingChange,
  showArchived,
  onShowArchivedChange,
  showOnlyWaiting = true,
}) {
  return (
    <div role="group" aria-label="Filtros" className="v3-projects__filters">
      <label htmlFor="projects-workspace-filter" className="v3-projects__sr-only">Workspace</label>
      <select
        id="projects-workspace-filter"
        className="v3-projects__select v3-type-body-sm"
        value={workspaceKey}
        onChange={(event) => onWorkspaceChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {showOnlyWaiting && (
        <label className="v3-projects__check v3-type-body-sm">
          <input type="checkbox" checked={onlyWaiting} onChange={(event) => onOnlyWaitingChange(event.target.checked)} />
          Só quem espera você
        </label>
      )}
      <label className="v3-projects__check v3-type-body-sm">
        <input type="checkbox" checked={showArchived} onChange={(event) => onShowArchivedChange(event.target.checked)} />
        Mostrar arquivados
      </label>
    </div>
  )
}
