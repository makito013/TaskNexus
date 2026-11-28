import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DOCK_MIN_WIDTH, useDockWidth } from '../../../../hooks/useDockWidth.js'
import { useArtifacts } from '../../../../hooks/useArtifacts.js'
import { useArtifactTabsStorage } from '../../../../hooks/useArtifactTabsStorage.js'
import { useViewer } from '../../../../hooks/viewerState.jsx'
import { api } from '../../../../services/api.js'
import { removeArtifact } from '../../../../services/artifactsApi.js'
import { isSafeSessionKey } from '../../../../services/sessionKey.js'
import { SOURCE_ARTIFACT, fileUrl } from '../../../../services/viewerApi.js'
import {
  SCOPE_ARTEFATOS,
  absolutePathFor,
  filterArtifacts,
  resolveArtifactLink,
  sortArtifacts,
  toViewerItem,
} from '../../../../utils/artifactModel.js'
import { copyTextToClipboard } from '../../../../utils/clipboard.js'
import { useToast } from '../../components/Toast/toastContext.js'
import { useChatSessionContext } from '../chat/ChatSessionHost.jsx'
import { localizeViewerMessage, useViewerShell, useViewportWidth } from '../viewer/ViewerShell.jsx'
import ViewerSurface from '../viewer/ViewerSurface.jsx'
import { DEFAULT_DOCK_WIDTH, SURFACE_ARTIFACTS, resolveViewerMode } from '../viewer/viewerLayout.js'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'
import ArtifactGallery from './ArtifactGallery.jsx'
import ArtifactMenu from './ArtifactMenu.jsx'
import ArtifactsControls from './ArtifactsControls.jsx'
import CiteDialog from './CiteDialog.jsx'
import ImportArtifactsDialog from './ImportArtifactsDialog.jsx'
import RenameArtifactDialog from './RenameArtifactDialog.jsx'
import { ALL_PROJECTS, DO_WORKSPACE, buildArtifactScope, groupArtifacts, importableProjects, isUnassignedKey } from './artifactScope.js'
import { citeTargetsFor } from './citeTargets.js'
import './Artifacts.css'

const EMPTY_HINT = 'Toque num artefato da lista para abri-lo aqui.'
const NO_CONVERSATION = 'Abra uma conversa deste projeto para citar.'
const NO_PROJECT_FOLDER = 'Este artefato não está num projeto com pasta cadastrada.'
const NO_IMPORT_PROJECT = 'Não há projeto cadastrado neste filtro para importar.'
const CLOSED_SURFACE = { open: false, fullscreen: false }

// What the shell takes from the viewport when the tab cannot be measured (jsdom, first paint): the rail and
// the paddings of the screen. The gallery never gets narrower than this next to a dock (a structural literal).
const SHELL_CHROME_WIDTH = 148
const GAP = 16
const GALLERY_MIN_WIDTH = 320

// How the viewer of the Artefatos tab is drawn: a dock beside the gallery from 1280 px, a drawer from 1024,
// a full screen when the person asked for it (the tab shows the width notice below 1024). The same shape
// ViewerSurface reads from the chat layout; the drawn width never rewrites the saved preference.
function useArtifactsViewerLayout(rootRef) {
  const viewer = useViewer()
  const dock = useDockWidth()
  const viewportWidth = useViewportWidth()
  const [contentWidth, setContentWidth] = useState(null)
  const previousModeRef = useRef(null)
  const surface = viewer ? viewer.getSurface(SURFACE_ARTIFACTS) : CLOSED_SURFACE

  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const measure = () => setContentWidth(element.clientWidth || null)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [rootRef])

  // While the handle is dragged the dock stays a dock: a column that turned into a drawer would unmount
  // the handle under the pointer and lose the pointerup that saves the width.
  const frozen = dock.dragging && previousModeRef.current === 'dock'
  const baseMode = frozen ? 'dock' : resolveViewerMode({ surface: SURFACE_ARTIFACTS, viewportWidth, fullscreen: false })
  useEffect(() => {
    previousModeRef.current = baseMode
  })

  if (!viewer) return null
  let width = null
  if (baseMode === 'dock') {
    const room = (contentWidth ?? viewportWidth - SHELL_CHROME_WIDTH) - GAP - GALLERY_MIN_WIDTH
    width = Math.max(DOCK_MIN_WIDTH, Math.min(dock.width ?? DEFAULT_DOCK_WIDTH, room))
  }
  const dockColumn = surface.open && baseMode === 'dock'
  return {
    surface,
    mode: surface.fullscreen ? 'fullscreen' : baseMode,
    layoutMode: baseMode,
    dockColumn,
    collapseList: false,
    width,
    dock,
    phone: false,
    sectionProps: dockColumn ? { 'data-viewer-dock': '' } : {},
    sectionStyle: dockColumn ? { '--v3-viewer-dock-width': `${width ?? DEFAULT_DOCK_WIDTH}px` } : undefined,
  }
}

// Aba "Artefatos" of Projetos: the deliverables (.md, .html, .pdf) of the workspaces, in a gallery scoped by
// the registry, opened in the viewer panel beside it. The only writes of the module live here and in the
// two dialogs (ADR-63): remove, the paste into a terminal and the draft of a chat; the dialogs rename and
// import. Nothing here deletes a file.
//   registry         the registry index of the screen
//   workspaceKey     the header's workspace ('' = all, '__none' = outside any)
//   showArchived     the header's "Mostrar arquivados"
//   onHasUnassigned  true/false once an UNFILTERED read says whether an artifact lives outside every
//                    workspace (the header's filter needs that option, or it would be unreachable)
export default function ArtifactsTab({ registry, workspaceKey = '', showArchived = false, onHasUnassigned }) {
  const viewer = useViewer()
  const shell = useViewerShell()
  const toast = useToast()
  const chatSession = useChatSessionContext()
  const { chats, liveByKey, openChat } = useProjectsSessions()
  const rootRef = useRef(null)
  const galleryRef = useRef(null)
  const lastOpenedRef = useRef(null)
  const restoreFocusRef = useRef(null)

  const [refinement, setRefinement] = useState({ workspaceKey: '', projectKey: ALL_PROJECTS })
  const [tipo, setTipo] = useState('todos')
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('recentes')
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [importing, setImporting] = useState(false)
  const [citing, setCiting] = useState(null)

  // The project refinement belongs to the workspace it was chosen in, and one that left the options (an
  // archived project once the switch is off) no longer narrows anything.
  const chosen = refinement.workspaceKey === workspaceKey ? refinement.projectKey : ALL_PROJECTS
  const offered = useMemo(
    () => buildArtifactScope({ registry, workspaceKey, projectKey: ALL_PROJECTS, showArchived }).projectOptions,
    [registry, workspaceKey, showArchived],
  )
  const projectKey = offered.some((option) => option.value === chosen) ? chosen : ALL_PROJECTS
  // Changing the workspace drops the refinement for good (it does not come back with the workspace).
  useEffect(() => {
    if (refinement.workspaceKey !== workspaceKey && refinement.projectKey !== ALL_PROJECTS) {
      setRefinement({ workspaceKey, projectKey: ALL_PROJECTS })
    }
  }, [refinement, workspaceKey])
  // A refinement that left the options (an archived project, once "Mostrar arquivados" is off) is dropped
  // from the state too (D-18): it must not come back when the switch is turned on again.
  useEffect(() => {
    if (chosen !== projectKey) setRefinement({ workspaceKey, projectKey: ALL_PROJECTS })
  }, [chosen, projectKey, workspaceKey])
  const scope = useMemo(
    () => buildArtifactScope({ registry, workspaceKey, projectKey, showArchived }),
    [registry, workspaceKey, projectKey, showArchived],
  )

  useArtifactTabsStorage(viewer)
  const { artifacts: read, clienteId: readFor, errorClienteId, error: readError, reload, upsertLocal, removeLocal } = useArtifacts({
    clienteId: scope.clienteId,
    signal: viewer?.artifactsSignal ?? 0,
  })
  // The list is only what it was read for: after the header changes the workspace, the one in hand belongs
  // to the previous workspace until the new answer arrives (skeleton meanwhile, the error with "Tentar de
  // novo" if that read fails). "Todos" and "Sem workspace" share the unfiltered read (both null).
  const artifacts = read !== null && readFor === scope.clienteId ? read : null
  const error = artifacts !== null || errorClienteId === scope.clienteId ? readError : null

  // The tabs already open follow the list (a renamed title, a file changed on disk).
  const syncItems = viewer?.syncItems
  useEffect(() => {
    if (!artifacts || !syncItems) return
    syncItems(SCOPE_ARTEFATOS, artifacts.map(toViewerItem), { source: SOURCE_ARTIFACT })
  }, [artifacts, syncItems])

  // Only a read with no workspace filter says what lives outside the workspaces.
  useEffect(() => {
    if (!onHasUnassigned || artifacts === null || scope.clienteId !== null) return
    onHasUnassigned(artifacts.some((artifact) => isUnassignedKey(artifact.project_id, registry)))
  }, [onHasUnassigned, artifacts, scope.clienteId, registry])

  const scoped = useMemo(() => (artifacts || []).filter((artifact) => scope.matches(artifact.project_id)), [artifacts, scope])
  const visible = useMemo(
    () => sortArtifacts(filterArtifacts(scoped, { tipo, q: query }), order),
    [scoped, tipo, query, order],
  )
  const groups = useMemo(
    () => (projectKey === ALL_PROJECTS ? groupArtifacts(visible, registry, order) : null),
    [projectKey, visible, registry, order],
  )
  const filtering = tipo !== 'todos' || query.trim() !== ''

  const layout = useArtifactsViewerLayout(rootRef)
  const scopeState = viewer ? viewer.getScope(SCOPE_ARTEFATOS) : null
  const surface = viewer ? viewer.getSurface(SCOPE_ARTEFATOS) : CLOSED_SURFACE
  const activeId = surface.open ? scopeState?.activeId ?? null : null

  const importProjects = useMemo(() => importableProjects(registry, workspaceKey), [registry, workspaceKey])
  let importInitial = null
  if (projectKey === DO_WORKSPACE) importInitial = workspaceKey
  else if (projectKey !== ALL_PROJECTS) importInitial = projectKey

  // -- where the focus goes back to (a card may be gone by then: the gallery takes it)
  const cardOpener = useCallback((artifactId) => (
    [...(rootRef.current?.querySelectorAll('[data-artifact-id]') ?? [])]
      .find((node) => node.dataset.artifactId === String(artifactId))?.querySelector('[data-artifact-open]') ?? null
  ), [])
  const returnToCard = (artifactId) => () => cardOpener(artifactId) ?? galleryRef.current
  const returnToLastOpened = useCallback(
    () => (lastOpenedRef.current != null ? cardOpener(lastOpenedRef.current) : null) ?? galleryRef.current,
    [cardOpener],
  )

  // -- the viewer
  const openArtifact = useCallback((artifact) => {
    if (!viewer) return
    lastOpenedRef.current = artifact.artifact_id
    // A drawer or a full screen takes the focus into itself when the person asked for it.
    if (layout && layout.layoutMode !== 'dock') shell?.requestPanelFocus()
    viewer.openItem(SCOPE_ARTEFATOS, toViewerItem(artifact), { source: SOURCE_ARTIFACT })
  }, [viewer, shell, layout])

  // A relative link inside an open artifact: another artifact of the list opens as a tab; anything else
  // opens the `f/` route of the artifact in a new browser tab (it serves the neighbours of the same
  // project under the same rules); a link that leaves the project root says so.
  const openLink = (path, options, item) => {
    if (!item) return
    const target = resolveArtifactLink(path, options)
    if (!target) {
      toast.push({ text: 'Esse link aponta para fora do projeto.' })
      return
    }
    const match = (artifacts || []).find((artifact) => artifact.project_id === item.project_id && artifact.path === target.path)
    if (match) {
      openArtifact(match)
      return
    }
    window.open(fileUrl(item, target.path), '_blank', 'noopener,noreferrer')
  }

  // -- the menu
  const openMenu = useCallback((artifact, { rect, trigger, viaLongPress = false }) => setMenu({ artifact, rect, trigger, viaLongPress }), [])
  const closeMenu = useCallback((restoreFocus) => {
    setMenu((current) => {
      if (current && restoreFocus) restoreFocusRef.current = { trigger: current.trigger, artifactId: current.artifact.artifact_id }
      return null
    })
  }, [])
  useEffect(() => {
    if (menu || !restoreFocusRef.current) return
    const { trigger, artifactId } = restoreFocusRef.current
    restoreFocusRef.current = null
    const target = trigger && trigger.isConnected ? trigger : cardOpener(artifactId) ?? galleryRef.current
    target?.focus?.({ preventScroll: true })
  }, [menu, cardOpener])

  const copyPath = async (artifact) => {
    let ok = false
    try {
      ok = await copyTextToClipboard(artifact.path)
    } catch {
      ok = false
    }
    toast.push(ok ? { text: 'Caminho copiado.' } : { text: 'Não consegui copiar o caminho.', kind: 'error' })
  }

  const handleRemove = async (artifact) => {
    try {
      // A 404 resolves as "already removed": the effect the person wants has happened.
      await removeArtifact(artifact.artifact_id)
    } catch (failure) {
      toast.push({ text: localizeViewerMessage(failure?.message, 'Não consegui remover da lista.'), kind: 'error' })
      return
    }
    removeLocal(artifact.artifact_id)
    if (scopeState?.items.some((item) => item.id === artifact.artifact_id)) viewer.closeItem(SCOPE_ARTEFATOS, artifact.artifact_id)
    toast.push({ text: 'Removido da lista. O arquivo continua no projeto.' })
    galleryRef.current?.focus({ preventScroll: true })
  }

  const handleRenamed = (updated) => {
    upsertLocal(updated)
    toast.push({ text: 'Artefato renomeado.' })
  }

  const handleImported = ({ created, artifacts: imported }) => {
    imported.forEach(upsertLocal)
    if (created > 0) toast.push({ text: created === 1 ? '1 artefato importado.' : `${created} artefatos importados.` })
    else if (imported.length > 0) toast.push({ text: 'Esses arquivos já estavam em Artefatos.' })
  }

  // -- "Citar no chat" (D-05): the ABSOLUTE path (the agent may be in another project), never sent.
  const absolutePathOf = (artifact) => {
    const project = registry.projectByKey.get(artifact.project_id)
    return project?.primaryPath ? absolutePathFor(artifact, [{ id: project.key, path: project.primaryPath }]) : null
  }
  const citeState = (artifact) => {
    if (!absolutePathOf(artifact)) return { enabled: false, reason: NO_PROJECT_FOLDER, targets: [] }
    const targets = citeTargetsFor(artifact, { chats, liveByKey })
    if (targets.length === 0) return { enabled: false, reason: NO_CONVERSATION, targets }
    return { enabled: true, reason: '', targets }
  }
  const citeTo = async (artifact, target) => {
    const absolute = absolutePathOf(artifact)
    if (!absolute) return
    if (target.kind === 'chat') {
      if (!chatSession?.queueDraft) {
        toast.push({ text: 'Não consegui citar na conversa.', kind: 'error' })
        return
      }
      chatSession.queueDraft(target.sessionKey, absolute)
      openChat(target.sessionKey)
      return
    }
    if (!isSafeSessionKey(target.sessionKey)) {
      toast.push({ text: 'Não consegui colar no terminal.', kind: 'error' })
      return
    }
    try {
      await api.pasteToSession(target.sessionKey, absolute)
    } catch {
      toast.push({ text: 'Não consegui colar no terminal.', kind: 'error' })
      return
    }
    openChat(target.sessionKey)
  }
  const startCite = (artifact) => {
    const { enabled, targets } = citeState(artifact)
    if (!enabled) return
    if (targets.length === 1) citeTo(artifact, targets[0])
    else setCiting({ artifact })
  }
  // The choice was made on a list that may be older than the sessions: it must still be there.
  const pickCite = (target) => {
    const { artifact } = citing
    setCiting(null)
    if (!citeState(artifact).targets.some((entry) => entry.sessionKey === target.sessionKey)) {
      toast.push({ text: 'Essa conversa já foi encerrada.', kind: 'error' })
      return
    }
    citeTo(artifact, target)
  }

  const openTabs = viewer ? scopeState.items.length : null

  return (
    <div ref={rootRef} className="v3-artifacts" {...(layout?.sectionProps ?? {})} style={layout?.sectionStyle}>
      <div className="v3-artifacts__main">
        <h2 className="v3-artifacts__heading">Artefatos</h2>
        <ArtifactsControls
          projectOptions={scope.projectOptions}
          projectKey={projectKey}
          onProjectChange={(value) => setRefinement({ workspaceKey, projectKey: value })}
          projectDisabled={!scope.hasProjectChoice}
          tipo={tipo}
          onTipoChange={setTipo}
          query={query}
          onQueryChange={setQuery}
          order={order}
          onOrderChange={setOrder}
          stale={artifacts !== null && Boolean(error)}
          openTabs={openTabs}
          panelOpen={surface.open}
          onTogglePanel={() => {
            if (!surface.open && layout && layout.layoutMode !== 'dock') shell?.requestPanelFocus()
            viewer.setOpen(SCOPE_ARTEFATOS, !surface.open)
          }}
          canImport={importProjects.length > 0}
          importHint={NO_IMPORT_PROJECT}
          onImport={() => setImporting(true)}
        />
        <ArtifactGallery
          galleryRef={galleryRef}
          artifacts={artifacts}
          error={error}
          groups={groups}
          items={visible}
          scopedCount={scoped.length}
          filtering={filtering}
          activeId={activeId}
          canImport={importProjects.length > 0}
          onOpen={openArtifact}
          onMenu={openMenu}
          onRetry={reload}
          onClearFilters={() => {
            setTipo('todos')
            setQuery('')
          }}
          onImport={() => setImporting(true)}
        />
      </div>

      <ViewerSurface
        layout={layout}
        surfaceName={SURFACE_ARTIFACTS}
        scope={SCOPE_ARTEFATOS}
        onOpenLink={openLink}
        emptyHint={EMPTY_HINT}
        returnFocusTo={returnToLastOpened}
      />

      {menu ? (
        <ArtifactMenu
          artifact={menu.artifact}
          anchorRect={menu.rect}
          viaLongPress={menu.viaLongPress}
          cite={citeState(menu.artifact)}
          onClose={closeMenu}
          onOpen={openArtifact}
          onCopyPath={copyPath}
          onCite={startCite}
          onRename={setRenaming}
          onRemove={handleRemove}
        />
      ) : null}
      {renaming ? (
        <RenameArtifactDialog
          artifact={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={handleRenamed}
          returnFocusTo={returnToCard(renaming.artifact_id)}
        />
      ) : null}
      {importing ? (
        <ImportArtifactsDialog
          projects={importProjects}
          registry={registry}
          initialProjectKey={importInitial}
          onClose={() => setImporting(false)}
          onImported={handleImported}
          returnFocusTo={() => galleryRef.current}
        />
      ) : null}
      {citing ? (
        <CiteDialog
          artifact={citing.artifact}
          targets={citeState(citing.artifact).targets}
          onPick={pickCite}
          onClose={() => setCiting(null)}
          returnFocusTo={returnToCard(citing.artifact.artifact_id)}
        />
      ) : null}
    </div>
  )
}
