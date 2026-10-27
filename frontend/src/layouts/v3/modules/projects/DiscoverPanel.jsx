import { useMemo, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { HISTORY_CHIP } from './FolderList.jsx'
import { pathKey } from './folderRules.js'

function seconds(ms) {
  return (Math.max(0, ms || 0) / 1000).toFixed(1).replace('.', ',')
}

function matches(entry, query) {
  if (!query) return true
  return [entry.name, entry.path, entry.client_key].some((text) => String(text ?? '').toLowerCase().includes(query))
}

// "Analisar automático": the map of the folders the V2 scan found, grouped by client.
// Presentational - the dialog owns the request (`discovery`: loading | error | ready)
// and decides what "Usar selecionadas" does.
//   folders           rows already in the project (their entries are disabled)
//   ownProjectId      the project being edited (its own use is not a warning)
//   workspaceId       workspace the project is created in
//   allowAdoption     adoption only happens when a project is CREATED
//   workspaces        registry workspaces, to explain an archived one
export default function DiscoverPanel({
  discovery,
  folders,
  ownProjectId = null,
  workspaceId = null,
  allowAdoption = true,
  workspaces = [],
  onRetry,
  onUse,
  onClose,
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const entries = discovery.status === 'ready' ? discovery.data.entries || [] : []
  const workspaceById = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces])
  const inList = useMemo(() => new Set(folders.map((folder) => pathKey(folder.path))), [folders])

  const wanted = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const byClient = new Map()
    for (const entry of entries) {
      if (!matches(entry, wanted)) continue
      if (!byClient.has(entry.client_key)) byClient.set(entry.client_key, [])
      byClient.get(entry.client_key).push(entry)
    }
    return [...byClient.entries()]
  }, [entries, wanted])

  const toggle = (path) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const count = selected.size
  const use = () => {
    if (count === 0) return
    onUse(entries.filter((entry) => selected.has(entry.path) && !inList.has(pathKey(entry.path))))
  }

  const total = entries.length
  return (
    <div className="v3-discover" role="group" aria-label="Mapa de pastas descobertas">
      <div className="v3-discover__head">
        <b className="v3-discover__title">Pastas descobertas</b>
        {discovery.status === 'ready' && (
          <span className="v3-discover__meta v3-type-mono-sm">
            {discovery.data.root} · {total} {total === 1 ? 'pasta elegível' : 'pastas elegíveis'} · varredura de {seconds(discovery.data.scanned_in_ms)} s
          </span>
        )}
        <span className="v3-discover__spacer" />
        <label className="v3-dialog__sr-only" htmlFor="discover-search">Buscar pasta</label>
        <input
          id="discover-search"
          className="v3-input v3-discover__search"
          placeholder="Buscar pasta"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {discovery.status === 'loading' && (
        <p className="v3-discover__state" role="status">Procurando as pastas…</p>
      )}
      {discovery.status === 'error' && (
        <div className="v3-discover__state" role="alert">
          <span>Não consegui varrer as pastas. Nada foi alterado.</span>
          <Button size="sm" onClick={onRetry}>Tentar de novo</Button>
        </div>
      )}
      {discovery.status === 'ready' && (
        <div className="v3-discover__tree">
          {groups.length === 0 && <p className="v3-discover__state">Nenhuma pasta encontrada com esse nome.</p>}
          {groups.map(([client, clientEntries]) => (
            <fieldset key={client} className="v3-discover__client">
              <legend className="v3-discover__legend">{client}</legend>
              {clientEntries.map((entry) => {
                const taken = inList.has(pathKey(entry.path))
                const others = (entry.used_by || []).filter((ref) => ref.project_id !== ownProjectId)
                const ownerId = entry.adoptable_into_workspace_id
                const owner = ownerId == null ? null : workspaceById.get(ownerId)
                const keepsHistory = allowAdoption && !taken && ownerId != null && ownerId === workspaceId && !owner?.archived
                const archivedOwner = allowAdoption && !taken && owner?.archived
                const id = `discover-${entry.legacy_key}`
                return (
                  <div key={entry.legacy_key} className="v3-discover__entry">
                    <label htmlFor={id} className="v3-discover__label">
                      <input
                        type="checkbox"
                        id={id}
                        checked={taken || selected.has(entry.path)}
                        disabled={taken}
                        onChange={() => toggle(entry.path)}
                      />
                      <span>
                        <span className="v3-discover__name">{entry.name}</span>
                        <br />
                        <span className="v3-discover__path v3-type-mono-sm">{entry.path}</span>
                      </span>
                    </label>
                    {taken && <Chip>já neste projeto</Chip>}
                    {!taken && others.map((ref) => (
                      <Chip key={ref.project_id} className="v3-folder-chip v3-folder-chip--warn">
                        <DialogIcon name="alert" size={14} />já está em {ref.workspace_name} › {ref.project_name}
                      </Chip>
                    ))}
                    {keepsHistory && <Chip className="v3-folder-chip v3-folder-chip--ok">{HISTORY_CHIP}</Chip>}
                    {archivedOwner && <Chip>workspace {owner.name} arquivado</Chip>}
                  </div>
                )
              })}
            </fieldset>
          ))}
        </div>
      )}

      <div className="v3-discover__foot">
        <span className="v3-discover__note">Marcar uma pasta já usada não bloqueia: ela só avisa onde está.</span>
        <Button size="sm" onClick={onClose}>Fechar mapa</Button>
        <Button
          size="sm"
          variant="primary"
          {...(count === 0 ? { 'aria-disabled': 'true', 'aria-describedby': 'duse-note' } : { onClick: use })}
        >
          Usar selecionadas ({count})
        </Button>
        {count === 0 && <span className="v3-dialog__sr-only" id="duse-note">Marque ao menos uma pasta.</span>}
      </div>
    </div>
  )
}
