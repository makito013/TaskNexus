import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoute } from '../../hooks/useRoute.js'
import ComingSoon from './components/ComingSoon/ComingSoon.jsx'
import Island from './components/Island/Island.jsx'
import ModuleRail from './components/ModuleRail/ModuleRail.jsx'
import Gallery from './dev/Gallery.jsx'
import { useTalkingPulse } from './hooks/useTalkingPulse.js'
import { IslandProvider } from './IslandContext.jsx'
import {
  DEFAULT_MODULE_ID,
  GALLERY_PATH,
  MODULES,
  colleaguesOf,
  moduleById,
  moduleForPath,
} from './modules.js'
import TasksScreen from './modules/tasks/TasksScreen.jsx'
import { useV3Theme } from './theme/useV3Theme.js'
import './AppV3.css'

const SCREENS = { tasks: TasksScreen }

// The v3 shell (desktop): module rail | content column with the sticky island on
// top and the screen of the open module below. The route table is modules.js;
// "/" and unknown paths are replaced (not pushed) by the default module, and the
// dev gallery lives outside the rail at GALLERY_PATH.
//
// The island is ONE element for the whole session (never keyed by module), so
// its role="status" phrase is announced when it changes. Modules with live data
// drive it through IslandContext; the others show their static phrase.
export default function AppV3({ initialTheme }) {
  const { theme, toggleTheme } = useV3Theme({ initialTheme })
  const [path, navigate, replace] = useRoute()
  const [islandReport, setIslandReport] = useState(null)

  const onGallery = path === GALLERY_PATH
  const routed = moduleForPath(path)
  const activeModule = onGallery ? null : routed || moduleById(DEFAULT_MODULE_ID)

  // After the redirect `path` is the replaced one (useRoute.replace updates it),
  // so nothing below reads a stale "/" or an unknown path.
  useEffect(() => {
    if (!onGallery && !routed) replace(moduleById(DEFAULT_MODULE_ID).path)
  }, [onGallery, routed, replace])

  const activeId = activeModule ? activeModule.id : null

  const openModule = useCallback(
    (moduleId) => {
      const target = moduleById(moduleId)
      if (target && target.id !== activeId) navigate(target.path)
    },
    [navigate, activeId],
  )

  // Move focus to the screen heading when the module changes, not on first load.
  const previousIdRef = useRef(activeId)
  useEffect(() => {
    if (previousIdRef.current === activeId) return
    previousIdRef.current = activeId
    if (activeId) document.querySelector('.v3-shell__screen h1')?.focus()
  }, [activeId])

  // A report of another module (or from before a module switch) is ignored.
  const liveReport = islandReport && islandReport.moduleId === activeId ? islandReport : null
  const message = liveReport?.message ?? activeModule?.islandMessage
  const baseState = liveReport?.state ?? (activeModule?.ready ? 'idle' : 'sleeping')
  const petState = useTalkingPulse(baseState, message)

  const Screen = activeModule && SCREENS[activeModule.id]

  return (
    <IslandProvider value={setIslandReport}>
      <ModuleRail
        modules={MODULES}
        activeId={activeId}
        onSelect={openModule}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="v3-main-column v3-shell__column">
        {activeModule && (
          <Island
            pet={activeModule.pet}
            state={petState}
            message={message}
            actions={liveReport?.actions}
            colleagues={colleaguesOf(activeModule.id)}
            onColleagueSelect={openModule}
          />
        )}
        <main className="v3-shell__screen">
          {onGallery && <Gallery />}
          {activeModule && (Screen ? <Screen /> : <ComingSoon key={activeModule.id} module={activeModule} />)}
        </main>
      </div>
    </IslandProvider>
  )
}
