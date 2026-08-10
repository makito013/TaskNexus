import { TerminalProvider } from './components/TerminalContext.jsx';
import { useRoute } from './hooks/useRoute.js';
import { AppLauncherHeader } from './components/AppLauncherHeader.jsx';
import { BoardView } from './views/BoardView.jsx';
import { TarefasGlobalView } from './views/TarefasGlobalView.jsx';
import { AppV1 } from './layouts/v1/AppV1.jsx';
import { AppV2 } from './layouts/v2/AppV2.jsx';

// Milestone 1 (plano Layout v2, 05-TL.md): fallback usado quando o backend
// não respondeu fetchAppearance() a tempo do boot (ver main.jsx) — nesse
// caso o layout v1 é o comportamento seguro e já validado em produção.
const DEFAULT_APPEARANCE = { layout_version: 'v1', theme_mode: 'dark' };

export default function App({ initialAppearance = DEFAULT_APPEARANCE } = {}) {
  const [path, navigate] = useRoute();

  return (
    <TerminalProvider>
      {/* Tarefa 17 (05-TL.md, achado #5 do Arquiteto/TL): `.app-root` (definida em
          index.css) foi desenhada quando MainLayout (hoje AppV1, ver
          layouts/v1/AppV1.jsx) era a única ocupante do viewport — usa
          `height: 100vh`/`100dvh` e `width: 100vw`/`100dvw` EXPLÍCITOS,
          relativos ao viewport inteiro, não ao pai flex. Ao envolver AppV1
          num container `flex:1` abaixo do novo header persistente, esses
          valores explícitos ignorariam o espaço reservado para o header e
          AppV1 tentaria ocupar a tela inteira de novo, estourando por baixo
          do container `overflow:hidden` (regressão visual — conteúdo cortado
          na borda inferior). Não é permitido editar index.css nem a
          implementação de AppV1 nesta tarefa, então a correção fica
          inteiramente aqui: uma regra escopada por classe que só se aplica
          quando `.app-root` está aninhada dentro do novo container roteado,
          forçando-a a herdar 100% do pai `flex:1` (que já é corretamente
          dimensionado pelo flexbox) em vez do viewport bruto. */}
      <style>{`
        .app-shell-routed-content .app-root {
          height: 100% !important;
          width: 100% !important;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Layout v2 (AppV2) tem sua própria navegação entre Chat/Board/
            Tarefas/Agentes na SidebarV2 — mostrar esta faixa por cima seria
            um segundo seletor redundante para a mesma escolha (pedido do
            Bruno). Some só quando o layout ativo é v2 e a rota corrente é a
            raiz (onde AppV2 é montado); /board e /tarefas continuam sendo
            rotas globais próprias (BoardView/TarefasGlobalView), que ainda
            usam o header para trocar de sistema. */}
        {!(initialAppearance.layout_version === 'v2' && path === '/') && (
          <AppLauncherHeader currentPath={path} onNavigate={navigate} />
        )}
        <div className="app-shell-routed-content" style={{ flex: 1, overflow: 'hidden' }}>
          {path === '/board' ? (
            <BoardView navigate={navigate} />
          ) : path === '/tarefas' ? (
            <TarefasGlobalView navigate={navigate} />
          ) : initialAppearance.layout_version === 'v2' ? (
            <AppV2 initialAppearance={initialAppearance} />
          ) : (
            <AppV1 initialAppearance={initialAppearance} />
          )}
        </div>
      </div>
    </TerminalProvider>
  );
}
