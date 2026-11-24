import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery.js'
import { useRoute } from '../../hooks/useRoute.js'
import ComingSoon from './components/ComingSoon/ComingSoon.jsx'
import Island from './components/Island/Island.jsx'
import ModuleRail from './components/ModuleRail/ModuleRail.jsx'
import { useTalkingPulse } from './hooks/useTalkingPulse.js'
import { IslandProvider } from './IslandContext.jsx'
import {
  DEFAULT_MODULE_ID,
  MODULES,
  colleaguesOf,
  moduleById,
  pushSessionKey,
  routeForPath,
} from './modules.js'
import ChatScreen from './modules/chat/ChatScreen.jsx'
import ChatSessionHost from './modules/chat/ChatSessionHost.jsx'
import ChatViewportShell from './modules/chat/ChatViewportShell.jsx'
import { NARROW_SHELL_QUERY } from './modules/chat/viewport.js'
import ProjectsScreen from './modules/projects/ProjectsScreen.jsx'
import ProjectsSessionsProvider, { chatPath } from './sessions/ProjectsSessionsProvider.jsx'
import { useProjectsSessions } from './sessions/useProjectsSessions.js'
import TasksScreen from './modules/tasks/TasksScreen.jsx'
import { useV3Theme } from './theme/useV3Theme.js'
import './AppV3.css'

const SCREENS = { tasks: TasksScreen, projects: ProjectsScreen }

// A push notification opens `/?session=<key>`. Once the first poll answered, a key that is a chat goes
// to its conversation and any other key goes to Projects (the V2 terminal keys have no screen here).
// Renders nothing; replace (not push) keeps the back button out of the redirect.
function PushLinkRedirect({ sessionKey, replace }) {
  const { chats, loaded } = useProjectsSessions()
  useEffect(() => {
    if (!loaded) return
    const isChat = chats.some((chat) => chat?.session_key === sessionKey)
    replace(isChat ? chatPath(sessionKey) : moduleById('projects').path)
  }, [loaded, chats, sessionKey, replace])
  return null
}

// The v3 shell (desktop): module rail | content column with the sticky island on
// top and the screen of the open module below. The route table is modules.js;
// "/" and unknown paths are replaced (not pushed) by the default module.
//
// The island is ONE element for the whole session (never keyed by module), so
// its role="status" phrase is announced when it changes. Modules with live data
// drive it through IslandContext; the others show their static phrase.
export default function AppV3({ initialTheme }) {
  const { theme, toggleTheme } = useV3Theme({ initialTheme })
  const [path, navigate, replace] = useRoute()
  const [islandReport, setIslandReport] = useState(null)

  // Read once: after the redirect the query string is gone from the address.
  const [linkedKey] = useState(() => pushSessionKey(window.location.pathname, window.location.search))
  const pendingPushKey = linkedKey && path === '/' ? linkedKey : null

  const route = routeForPath(path)
  const routed = route ? moduleById(route.moduleId) : null
  const isChat = route?.view === 'chat'
  const activeModule = routed || moduleById(DEFAULT_MODULE_ID)

  // After the redirect `path` is the replaced one (useRoute.replace updates it),
  // so nothing below reads a stale "/" or an unknown path.
  useEffect(() => {
    if (!routed && !pendingPushKey) replace(moduleById(DEFAULT_MODULE_ID).path)
  }, [routed, pendingPushKey, replace])

  const activeId = activeModule.id

  // The chat route has its own responsive shell (phone/tablet, decision D4): the stylesheets key on this
  // attribute of #root, written here and removed on leaving, so no other route is ever affected.
  useEffect(() => {
    if (!isChat) return undefined
    const root = document.getElementById('root')
    if (!root) return undefined
    root.dataset.v3Route = 'chat'
    return () => {
      delete root.dataset.v3Route
    }
  }, [isChat])
  const narrowShell = useMediaQuery(NARROW_SHELL_QUERY)

  const openModule = useCallback(
    (moduleId) => {
      const target = moduleById(moduleId)
      // From a chat, the module's own entry leads back to the module's screen.
      if (target && (target.id !== activeId || isChat)) navigate(target.path)
    },
    [navigate, activeId, isChat],
  )

  // Move focus to the screen heading when the module changes, not on first load.
  const previousIdRef = useRef(activeId)
  useEffect(() => {
    if (previousIdRef.current === activeId) return
    previousIdRef.current = activeId
    document.querySelector('.v3-shell__screen h1')?.focus()
  }, [activeId])

  // A report of another module (or from before a module switch) is ignored.
  const liveReport = islandReport && islandReport.moduleId === activeId ? islandReport : null
  const message = liveReport?.message ?? activeModule.islandMessage
  const baseState = liveReport?.state ?? (activeModule.ready ? 'idle' : 'sleeping')
  const petState = useTalkingPulse(baseState, message)

  const Screen = isChat ? ChatScreen : SCREENS[activeModule.id]
  const screenProps = isChat ? { sessionKey: route.sessionKey } : undefined

  return (
    <IslandProvider value={setIslandReport}>
      <ProjectsSessionsProvider navigate={navigate}>
        {pendingPushKey ? <PushLinkRedirect sessionKey={pendingPushKey} replace={replace} /> : null}
        {/* Above <main>: the open conversation's socket outlives the screen (CA38). Inert until a chat is opened. */}
        <ChatSessionHost activeKey={isChat ? route.sessionKey : null}>
          {/* Anchors the shell root to the visual viewport (soft keyboard) only on the chat route, <= 1279. */}
          {isChat && narrowShell ? <ChatViewportShell /> : null}
          <ModuleRail
            modules={MODULES}
            activeId={activeId}
            onSelect={openModule}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          <div className="v3-main-column v3-shell__column">
            <Island
              pet={activeModule.pet}
              state={petState}
              message={message}
              actions={liveReport?.actions}
              colleagues={colleaguesOf(activeModule.id)}
              onColleagueSelect={openModule}
            />
            <main className="v3-shell__screen">
              {Screen ? <Screen {...screenProps} /> : <ComingSoon key={activeModule.id} module={activeModule} />}
            </main>
          </div>
        </ChatSessionHost>
      </ProjectsSessionsProvider>
    </IslandProvider>
  )
}
