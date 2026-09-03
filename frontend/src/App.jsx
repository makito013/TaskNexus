import { TerminalProvider } from './components/TerminalContext.jsx';
import { useRoute } from './hooks/useRoute.js';
import { AppLauncherHeader } from './components/AppLauncherHeader.jsx';
import { TarefasGlobalView } from './views/TarefasGlobalView.jsx';
import { AppV2 } from './layouts/v2/AppV2.jsx';

const DEFAULT_APPEARANCE = { layout_version: 'v2', theme_mode: 'light' };

export default function App({ initialAppearance = DEFAULT_APPEARANCE } = {}) {
  const [path, navigate] = useRoute();

  return (
    <TerminalProvider>
      <style>{`
        .app-shell-routed-content .app-root {
          height: 100% !important;
          width: 100% !important;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {path !== '/' && (
          <AppLauncherHeader currentPath={path} onNavigate={navigate} />
        )}
        <div className="app-shell-routed-content" style={{ flex: 1, overflow: 'hidden' }}>
          {/* Two named routes; anything else falls through to AppV2, which is
              also what the retired `/board` route now hits when someone opens
              an old bookmark. */}
          {path === '/tarefas' ? (
            <TarefasGlobalView navigate={navigate} />
          ) : (
            <AppV2 initialAppearance={initialAppearance} />
          )}
        </div>
      </div>
    </TerminalProvider>
  );
}
