import { useCallback, useEffect, useRef } from 'react'
import { useRoute } from '../../hooks/useRoute.js'
import ComingSoon from './components/ComingSoon/ComingSoon.jsx'
import Island from './components/Island/Island.jsx'
import ModuleRail from './components/ModuleRail/ModuleRail.jsx'
import Gallery from './dev/Gallery.jsx'
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
export default function AppV3({ initialTheme }) {
  const { theme, toggleTheme } = useV3Theme({ initialTheme })
  const [path, navigate] = useRoute()

  const onGallery = path === GALLERY_PATH
  const routed = moduleForPath(path)
  const activeModule = onGallery ? null : routed || moduleById(DEFAULT_MODULE_ID)

  useEffect(() => {
    if (!onGallery && !routed) {
      window.history.replaceState({}, '', moduleById(DEFAULT_MODULE_ID).path)
    }
  }, [onGallery, routed])

  const openModule = useCallback(
    (moduleId) => {
      const target = moduleById(moduleId)
      if (target && window.location.pathname !== target.path) navigate(target.path)
    },
    [navigate],
  )

  // Move focus to the screen heading when the module changes, not on first load.
  const activeId = activeModule ? activeModule.id : null
  const previousIdRef = useRef(activeId)
  useEffect(() => {
    if (previousIdRef.current === activeId) return
    previousIdRef.current = activeId
    if (activeId) document.querySelector('.v3-shell__screen h1')?.focus()
  }, [activeId])

  const Screen = activeModule && SCREENS[activeModule.id]

  return (
    <>
      <ModuleRail
        modules={MODULES}
        activeId={activeModule ? activeModule.id : null}
        onSelect={openModule}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="v3-main-column v3-shell__column">
        {activeModule && (
          <Island
            key={activeModule.id}
            pet={activeModule.pet}
            state={activeModule.ready ? 'idle' : 'sleeping'}
            message={activeModule.islandMessage}
            colleagues={colleaguesOf(activeModule.id)}
            onColleagueSelect={openModule}
          />
        )}
        <main className="v3-shell__screen">
          {onGallery && <Gallery />}
          {activeModule && (Screen ? <Screen /> : <ComingSoon key={activeModule.id} module={activeModule} />)}
        </main>
      </div>
    </>
  )
}
