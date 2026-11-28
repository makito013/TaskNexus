import { useEffect, useRef, useState } from 'react'
import { openerLabel, useViewer, useViewerActions } from '../../../../hooks/viewerState.jsx'
import { connectViewerFeed } from '../../../../services/viewerFeed.js'
import { sessionKeyFromScope, sessionScope } from '../../../../services/viewerApi.js'
import { basenameOf } from '../../../../utils/viewerPaths.js'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'

const ANNOUNCE_MS = 4000

// Connects the shell to the live feed of the server (`/ws/viewer`) and hands what it hears to the viewer state:
//   viewer_open   receiveOpen(...): the tab is inserted (or reused); a conversation that is on screen opens the
//                 panel by itself and a polite status line says so (the focus never moves); any other conversation
//                 adds to the seal and raises the "Ver" toast (ViewerToast).
//   ready         the first one and every reconnection: nothing is replayed, so the tabs of the active conversation
//                 and of every conversation already loaded are fetched again, and the artifacts list is told to
//                 reload (the signal an opened .md/.html/.pdf raises).
// The socket opens the first time a live session exists (nobody opens a file without one) and closes only when the
// shell unmounts. Opening and closing live in ONE effect (close() also silences the client at once: nothing it
// hears afterwards reaches the callbacks), so StrictMode's double effect leaves exactly one socket.
export default function ViewerFeedBridge() {
  const actions = useViewerActions()
  const viewer = useViewer()
  const { liveByKey } = useProjectsSessions()
  const anyLive = Object.keys(liveByKey ?? {}).length > 0
  const [wanted, setWanted] = useState(anyLive)
  const [announcement, setAnnouncement] = useState(null)
  const viewerRef = useRef(viewer)
  viewerRef.current = viewer

  useEffect(() => {
    if (anyLive) setWanted(true)
  }, [anyLive])

  useEffect(() => {
    if (!wanted || !actions) return undefined
    const feed = connectViewerFeed({
      onOpen: (sessionKey, item, reused, evicted) => {
        const host = actions.hostRef.current
        const onScreen = Boolean(host.chatVisible) && host.activeSessionKey === sessionKey
        actions.receiveOpen(sessionKey, item, reused, evicted)
        if (onScreen) {
          // A new object each time: the same file opened twice is announced twice.
          setAnnouncement({ text: `${openerLabel(item, sessionKey)} abriu ${item.title || basenameOf(item.path)}.` })
        }
      },
      onReady: () => {
        const scopes = new Set(
          Object.entries(viewerRef.current?.scopes ?? {})
            .filter(([scope, state]) => sessionKeyFromScope(scope) !== null && state.loaded)
            .map(([scope]) => scope),
        )
        const activeKey = actions.hostRef.current.activeSessionKey
        if (activeKey) scopes.add(sessionScope(activeKey))
        for (const scope of scopes) actions.loadItems(scope, { force: true })
        actions.notifyArtifactsChanged()
      },
    })
    return () => feed.close()
  }, [wanted, actions])

  useEffect(() => {
    if (!announcement) return undefined
    const timer = setTimeout(() => setAnnouncement(null), ANNOUNCE_MS)
    return () => clearTimeout(timer)
  }, [announcement])

  // Rendered only while it has a sentence: a permanent status region would give every screen a second
  // role="status" (the tests and the screens look for their own).
  return announcement ? <span className="v3-viewer-sr-only" role="status">{announcement.text}</span> : null
}
