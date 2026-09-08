// frontend/src/layouts/v2/AppV2.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 12): casco do layout v2 —
// SidebarV2 (recolhível, 240px<->68px) + topbar (62px) + área de conteúdo.
// Substitui o PlaceholderV2 temporário do Milestone 1 (ver App.jsx).
//
// Milestone 3 (Tarefas 15-16): Board/Tarefas/Agentes deixam de ser
// placeholders — BoardV2/TarefasV2/ConfiguracaoV2 (layouts/v2/) são as 3
// telas reais agora, cada uma reaproveitando o MESMO hook de dados que sua
// contraparte v1 (useCards/useGlobalTasks/useAgentSettings) já usa. A 4ª aba
// passou a se chamar "Configuração" (rótulo visível) quando ganhou CRUD
// completo de agentes + o seletor de pasta de projetos; o `id` interno da
// tela continua `agentes`.
//
// A navegação entre as 4 telas continua um useState local simples
// (`v2Screen`), sem roteador nem persistência — trocar de aba não é uma URL
// navegável (decisão de Milestone 2, inalterada aqui).
//
// theme.css é importado SÓ aqui — o único entrypoint do layout v2 — para que
// o v1 nunca pague o custo/risco de cascata dos tokens --v2-*.
import './theme.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminal } from '../../components/TerminalContext.jsx';
import { useProjects } from '../../hooks/useProjects.js';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  useVisibleViewportShell,
  SHELL_BASE_RECT_STYLE,
} from '../../hooks/useVisibleViewportShell.js';
import { useTasks } from '../../hooks/useTasks.js';
import { clienteIdFromProjetoId, isClienteId } from '../../utils/clientes.js';
import { MOBILE_VIEWPORT_QUERY } from '../../utils/viewport.js';
import { SidebarV2 } from './SidebarV2.jsx';
import { ChatSidebarV2 } from './ChatSidebarV2.jsx';
import { ChatV2 } from './ChatV2.jsx';
import { BoardV2 } from './BoardV2.jsx';
import { TarefasV2 } from './TarefasV2.jsx';
import { ConfiguracaoV2 } from './ConfiguracaoV2.jsx';
import { ResetLayoutButton } from './ResetLayoutButton.jsx';
import { AttachmentsMenu } from './AttachmentsMenu.jsx';
import { MobileMenuScreen } from './MobileMenuScreen.jsx';
import { MobileChatSheet } from './MobileChatSheet.jsx';

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'tarefas', label: 'Tarefas', icon: '✓' },
  // `id` stays 'agentes' on purpose: it is the internal screen key wired to
  // `v2Screen`/`SCREEN_TITLES` and to the `agentes-v2-card-*` test ids. Only
  // the user-facing label became "Configuração" when the screen grew full
  // agent CRUD + the projects-folder setting.
  { id: 'agentes', label: 'Configuração', icon: '◈' },
];

const SCREEN_TITLES = { chat: 'Chat', board: 'Board', tarefas: 'Tarefas', agentes: 'Configuração' };

export function AppV2({ initialAppearance }) {
  const {
    sessions,
    activeSessionKey,
    selectedProjectId,
    selectProject,
    startSession,
    startNewInstance,
    terminateSession,
    renameSession,
    activeSessions,
    persistedSessions,
  } = useTerminal();

  // ConfiguracaoV2 gerencia o refetch da lista de AGENTES sozinha, via
  // useAgentSettings (endpoint /api/agents, GLOBAL). Mas /api/projects é
  // outro endpoint, e a lista de projetos embute os agentes disponíveis por
  // projeto (SidebarV2/ChatSidebarV2/BoardV2 leem dali para resolver
  // nome/agentes e oferecer "novo chat"). Por isso `refreshProjects` desce
  // até ConfiguracaoV2 como `onAgentsChanged`: sem ele, um agente criado/
  // editado/excluído lá deixaria /api/projects obsoleto até um reload
  // manual.
  const [projects, refreshProjects] = useProjects();
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  // RF02 (etapa 7): 2ª chave do mesmo hook compartilhado, sob uma chave de
  // localStorage própria — NÃO um useState local (reintroduziria o bug do
  // "espaço morto no terminal", já que só o hook dispara
  // `escritorio:sidebar-toggled`, o evento que TerminalPanel escuta pra
  // reagendar o fitAddon.fit()).
  const [chatSidebarCollapsed, toggleChatSidebar] = useSidebarCollapsed(
    'escritorio::chat_sidebar_collapsed'
  );
  const [v2Screen, setV2Screen] = useState('chat');

  // Rodada "Novo chat em modal": CenteredModal (Tarefa 6) é portalizado pra
  // document.body, então não é descendente da árvore abaixo — aplicar
  // `inert` nela não desativa o próprio modal. Só ChatSidebarV2 (desktop,
  // presentation="modal") pode abrir um CenteredModal; MobileChatSheet usa
  // BottomSheet (presentation="sheet", fora deste contrato — ver
  // style-guide.md §1). Escopo desta rodada: só o CenteredModal desta
  // feature, não o CardFormModal/BoardV2 (decisão do Bruno).
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Rodada 2, Frente B: o casco do v2 acompanha a área REALMENTE visível, para
  // que abrir o teclado nativo do iPad encolha o app ("tela − teclado") em vez
  // de o teclado cobrir o chat e o Safari empurrar a topbar para fora da tela.
  // Toda a mecânica (e o porquê de cada parte dela) está em
  // hooks/useVisibleViewportShell.js; aqui só entram o ref e o nó.
  const shellRef = useRef(null);
  useVisibleViewportShell(shellRef);

  // Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 12):
  // `isMobile` só é true abaixo de MOBILE_VIEWPORT_QUERY (640px) — nunca em
  // nenhum modo de iPad (confirmado pelo Bruno), então o caminho tablet/
  // desktop abaixo nunca lê `mobileView`. `mobileView` é ortogonal a
  // `v2Screen` (que continua a única fonte de verdade da aba ativa).
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  const [mobileView, setMobileView] = useState('menu'); // 'menu' | 'chatModal' | 'content'

  // Mobile phone-lock fix (Bruno, confirmed): a backgrounded (non-PWA) tab can
  // get fully discarded by the OS/browser and reload from scratch once the
  // phone is unlocked again. `activeSessionKey` is restored synchronously
  // from localStorage, but `sessions` (TerminalContext) always starts empty
  // and only fills once its own restore fetch(es) resolve — jumping straight
  // to 'content' on mount (tried first) showed ChatV2's "Selecione um chat…"
  // placeholder for that gap, and got stuck on it forever for a session that
  // turned out to be gone from both active and persisted. This instead stays
  // on the safe, already-tested 'menu' default and swaps to 'content' the
  // moment `sessions` actually confirms the page-load-restored key — mirrors
  // TerminalContext's own one-shot "only the page-load key, only once"
  // pattern (D-13) so it can never re-fire for a later selection, and the
  // `mobileView !== 'menu'` check below means it never fights a manual tap
  // the user made while the restore was still in flight.
  const initialMobileSessionKeyRef = useRef(activeSessionKey);
  const mobileRestoreHandledRef = useRef(false);
  useEffect(() => {
    if (mobileRestoreHandledRef.current) return;
    const key = initialMobileSessionKeyRef.current;
    if (!key || mobileView !== 'menu') {
      mobileRestoreHandledRef.current = true;
      return;
    }
    if (sessions.some((s) => s.sessionKey === key)) {
      mobileRestoreHandledRef.current = true;
      setMobileView('content');
    }
  }, [sessions, mobileView]);

  // Sair do mobile (rotação, resize da janela) com o modal/conteúdo mobile
  // ainda aberto não pode deixar esse estado obsoleto pendurado — força de
  // volta pro menu, senão reaparece sozinho se a tela voltar a ficar estreita.
  useEffect(() => {
    if (!isMobile && mobileView !== 'menu') setMobileView('menu');
  }, [isMobile, mobileView]);

  // Botão "Ajustar layout" (Chat, Layout v2): sempre aponta para o
  // TerminalPanel da sessão ATIVA no momento — mesmo padrão de
  // layouts/v1/AppV1.jsx's activePanelRef. Mutado só no ref callback do
  // ChatV2 (commit phase), nunca durante o render.
  const activePanelRef = useRef(null);

  // Fase "Tarefas" no v2 (plano do TL, Tarefa 8): o v2 nunca havia falado com
  // o backend de tarefas até aqui. Instanciamos useTasks só para expor
  // `createTask` ao botão "+ Tarefa" do header do ChatV2 — o polling do hook
  // fica gated em `drawerOpen` (que o v2 não abre), então nenhuma chamada de
  // rede acontece até o usuário criar uma tarefa de fato.
  const { createTask } = useTasks(activeSessionKey);

  // Feature Clientes na sidebar v2 (Bloco B): estado de "cliente selecionado"
  // é INDEPENDENTE do `selectedProjectId` do TerminalContext, que continua
  // dirigindo só o painel de Chat (ChatV2) sem mudança nenhuma aqui. BoardV2
  // é a exceção desde a Fase 2 do plano (bug reportado pelo Bruno: um card
  // criado num subprojeto era invisível no board sem um chat aberto NAQUELE
  // subprojeto específico) — recebe `selectedClienteId` abaixo pra filtrar
  // pelo cliente da sidebar, exatamente como TarefasV2 já fazia. `null` =
  // "Todos" — mesmo sentinel que a cascata de filtro das telas v2 já usa.
  // Lazy-init a partir do projeto atualmente selecionado, pra abrir já
  // filtrado no cliente certo em vez de sempre cair em "Todos" no 1º render.
  const [selectedClienteId, setSelectedClienteId] = useState(
    () => (selectedProjectId ? clienteIdFromProjetoId(selectedProjectId) : null)
  );

  // "Clientes" candidatos à sidebar: qualquer Project cujo id não tem "/"
  // (cliente-como-projeto e projeto-solto-na-raiz contam como cliente de si
  // mesmos) — mesma regra usada pelo Tier 1 da cascata de filtro,
  // centralizada em `isClienteId` (utils/clientes.js) para não triplicar a
  // regra (ressalva do Revisor na Fase 1, endereçada aqui na Fase 2).
  const clientes = useMemo(() => projects.filter((p) => isClienteId(p.id)), [projects]);

  // "Todos" (null) é só um filtro da coluna da esquerda: NÃO toca
  // selectedProjectId/activeSessionKey — o chat aberto no ChatV2 continua
  // exatamente onde estava. Selecionar um cliente de verdade, por outro lado,
  // mantém o painel principal em sincronia (mesmo comportamento de hoje).
  const handleSelectCliente = (clienteId) => {
    setSelectedClienteId(clienteId);
    if (clienteId != null) selectProject(clienteId);
  };

  /** Fase 4 (v1) reaproveitada aqui: pode vir de um projeto diferente do
   * atualmente selecionado, então também troca o projeto selecionado.
   * startSession reconecta via --resume se o PTY já morreu. */
  const handleSelectChat = (chat) => {
    selectProject(chat.projectId);
    startSession(chat.sessionKey, chat.projectId, chat.agentId);
  };

  const handleCloseChat = async (key) => {
    if (window.confirm('Encerrar esta sessão? O processo PTY será terminado no servidor.')) {
      await terminateSession(key);
    }
  };

  // Tap num cliente no menu mobile (MobileMenuScreen): no contexto Chat abre
  // o modal de chats (RF04 — há uma decisão real a tomar: qual conversa); em
  // Board/Tarefas/Agentes vai direto pro conteúdo em tela cheia (RF07/RF08,
  // decisão do Bruno — sem modal intermediário, não existe "qual board abrir").
  const handleMobileSelectCliente = (clienteId) => {
    handleSelectCliente(clienteId);
    setMobileView(v2Screen === 'chat' ? 'chatModal' : 'content');
  };

  const handleMobileSelectChat = (chat) => {
    handleSelectChat(chat);
    setMobileView('content');
  };

  const handleMobileStartNewChat = (projetoId, agentId) => {
    startNewInstance(projetoId, agentId);
    setMobileView('content');
  };

  return (
    /*
      ⛔ PROIBIDO NESTE NÓ E EM QUALQUER ANCESTRAL DELE: `transform`, `filter`
      (e `backdrop-filter`), `will-change` e `contain`.

      Qualquer uma dessas 4 propriedades cria um containing block para
      descendentes `position: fixed`. O FAB de atalhos do terminal
      (layouts/v2/TerminalShortcutsFab.jsx) e o painel que ele abre são `fixed`
      e posicionam-se por `left`/`top` em px calculados contra a VIEWPORT
      (utils/fabGeometry.js). Se um ancestral relativizar o `fixed`, esses px
      passam a ser medidos a partir do ancestral: toda a matemática do FAB vira
      lixo e o botão vai para o lugar errado — sem erro, sem warning e sem
      teste vermelho. Inclui a proibição explícita de
      `transform: translateY(-offsetTop)` para compensar o pan do Safari: é a
      alternativa "óbvia" e é exatamente a que mata o FAB em silêncio. O pan é
      compensado por `top` em px, escrito por useVisibleViewportShell.
      A cadeia a preservar limpa: index.css (html/body/#root/.app-root),
      App.jsx (o div flex-column e `.app-shell-routed-content`), este arquivo,
      layouts/v2/ChatV2.jsx, components/terminalSkin.js (`root`/`frame`).
      Guarda automática: layouts/v2/fixedPositioningInvariant.test.js.

      `position: fixed` NESTE nó é seguro: `fixed` não cria containing block
      para descendentes `fixed`.

      Premissa de rota (risco B-R4): hoje o AppV2 só é montado em `path === '/'`,
      onde o AppLauncherHeader é deliberadamente ocultado (App.jsx) — ou seja o
      casco legitimamente ocupa a viewport inteira e não há irmão em fluxo para
      ele cobrir. Se uma rodada futura montar o AppV2 ABAIXO de um header, este
      `fixed` passa a cobri-lo e a premissa precisa ser revista aqui.

      `left`/`top`/`width`/`height` vêm de SHELL_BASE_RECT_STYLE e são
      ESTÁTICOS de propósito: useVisibleViewportShell os reescreve
      imperativamente, e React só reescreve chaves de `style` que mudaram entre
      renders — é isso que faz os valores imperativos sobreviverem aos
      re-renders. Tornar qualquer um dos 4 dinâmico aqui faz o React brigar com
      o hook e o casco oscilar a cada render (risco B-R3).
    */
    <div
      ref={shellRef}
      style={{
        display: 'flex',
        position: 'fixed',
        ...SHELL_BASE_RECT_STYLE,
        overflow: 'hidden',
        background: 'var(--v2-bg)',
        color: 'var(--v2-text)',
        // Milestone 3 (Tarefa 19): 'Figtree' primeiro na pilha — agora que o
        // @font-face self-hosted existe (theme.css), ela precisa vir ANTES
        // do fallback de sistema para ser efetivamente usada (uma pilha
        // "-apple-system, Figtree" nunca chegaria a pedir Figtree no
        // Safari/iPadOS, a plataforma alvo deste projeto, porque
        // -apple-system sempre resolve primeiro).
        fontFamily: "'Figtree', -apple-system, sans-serif",
      }}
    >
      {/* CONTRATO WCAG 2.4.3/nível-shell (style-guide.md §1): sempre que o
          CenteredModal do "Novo chat" está aberto, este wrapper (SidebarV2 +
          coluna principal) recebe `inert` — o overlay do modal bloqueia
          clique de mouse por z-index, mas NÃO bloqueia o cursor virtual de
          leitor de tela; sem isto, dava pra ativar um elemento coberto (ex.
          trocar de chat) sem perceber que o modal estava aberto.
          `aria-hidden="true"` como fallback documentado pra browsers sem
          suporte a `inert`. Spread condicional (não `inert={boolean}` direto):
          React 18 pode não remover o atributo de verdade quando o valor vira
          `false` — só ficou sólido no React 19. */}
      <div
        data-testid="app-v2-inertable-wrapper"
        style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}
        {...(newChatOpen ? { inert: '' } : {})}
        aria-hidden={newChatOpen ? 'true' : undefined}
      >
        {!isMobile && (
          <SidebarV2
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            clientes={clientes}
            selectedClienteId={selectedClienteId}
            onSelectCliente={handleSelectCliente}
            navItems={NAV_ITEMS}
            activeScreen={v2Screen}
            onSelectScreen={setV2Screen}
            initialAppearance={initialAppearance}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            height: '62px',
            minHeight: '62px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--v2-border)',
            background: 'var(--v2-surface)',
            flexShrink: 0,
          }}
        >
          {/* No mobile a topbar em si continua montada, mas o título some e o
              "Ajustar layout" também (achado do Revisor, etapa 9): sem o
              título, `justifyContent: 'space-between'` empurra o único filho
              restante pro canto ESQUERDO — exatamente onde fica o botão
              flutuante "☰ Menu" (abaixo). Ajustar layout também deixa de
              fazer sentido sozinho no mobile: ele reajusta o fit em resposta
              ao ChatSidebarV2 colapsar/expandir, e ChatSidebarV2 nem é
              montada aqui (SidebarV2 também não). */}
          {!isMobile && <span style={{ fontSize: '15px', fontWeight: 600 }}>{SCREEN_TITLES[v2Screen]}</span>}
          {!isMobile && v2Screen === 'chat' && (
            // Grupo com os dois controles de sessão ativa, nesta ordem (Designer:
            // Anexos à esquerda de "Ajustar layout" — é o botão que se prepara
            // *antes/durante* a tarefa, "Ajustar layout" é reativo). Envolvidos
            // num único filho flex para o `justifyContent: space-between` da
            // topbar continuar distribuindo só 2 itens (título vs. este grupo),
            // não 3 itens soltos.
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AttachmentsMenu activeSessionKey={activeSessionKey} />
              <ResetLayoutButton activePanelRef={activePanelRef} disabled={!activeSessionKey} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* A tela Chat fica SEMPRE montada (display:none quando outra tela
              está ativa), nunca desmontada pela troca de v2Screen — mesma
              decisão já tomada dentro de ChatV2 para as sessões individuais
              (e em AppV1.jsx). Desmontar ChatV2 ao navegar para Board/Tarefas/
              Agentes destrói todo TerminalPanel nela, incluindo o buffer local
              do xterm.js; ao remontar, o backend só reenvia os últimos 64KB de
              scrollback (PTYProcess.SCROLLBACK_MAX_BYTES), o que para um chat
              antigo (muito mais que 64KB de histórico) aparenta um "/clear"
              do nada — ver .planning/debug/blank-terminal-on-return.md,
              mesma classe de bug já corrigida uma vez neste projeto. Isso
              vale também para `isMobile`/`mobileView`: nenhuma navegação
              mobile pode desmontar este `<ChatV2>` — só os irmãos de sidebar
              (que não têm PTY dentro) somem condicionalmente ao redor dele. */}
          <div style={{ display: v2Screen === 'chat' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            {!isMobile && (
              <ChatSidebarV2
                projects={projects}
                activeSessionKey={activeSessionKey}
                activeSessions={activeSessions}
                persistedSessions={persistedSessions}
                selectedClienteId={selectedClienteId}
                onSelectChat={handleSelectChat}
                onRenameChat={renameSession}
                onCloseChat={handleCloseChat}
                onStartNewChat={startNewInstance}
                collapsed={chatSidebarCollapsed}
                onToggleCollapsed={toggleChatSidebar}
                onNewChatOpenChange={setNewChatOpen}
              />
            )}
            <ChatV2
              sessions={sessions}
              activeSessionKey={activeSessionKey}
              projects={projects}
              onCreateTask={createTask}
              activePanelRef={activePanelRef}
            />
          </div>
          {v2Screen === 'board' && (
            <BoardV2
              projects={projects}
              selectedClienteId={selectedClienteId}
            />
          )}
          {v2Screen === 'tarefas' && (
            <TarefasV2 projects={projects} selectedClienteId={selectedClienteId} />
          )}
          {v2Screen === 'agentes' && <ConfiguracaoV2 onAgentsChanged={refreshProjects} />}
        </div>
        </div>
      </div>

      {/* Botão flutuante "voltar ao menu" (navegação mobile, Tarefa 12): só
          existe em mobileView==='content' — é o ÚNICO mecanismo de troca de
          contexto a partir daí, sempre volta pro menu raiz (nunca "um passo
          atrás", decisão confirmada pelo Bruno), preservando `v2Screen`.
          Canto SUPERIOR esquerdo (não inferior): evita ficar coberto pelo
          teclado do iOS ao digitar no terminal. Sem `data-terminal-safe-tap`
          de propósito — o blur automático de TerminalPanel ao tocar fora do
          container deve disparar normalmente. */}
      {isMobile && mobileView === 'content' && (
        <button
          type="button"
          onClick={() => setMobileView('menu')}
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top) + 12px)',
            left: '12px',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '44px',
            padding: '0 16px',
            borderRadius: '999px',
            border: '1px solid var(--v2-border)',
            background: 'var(--v2-surface)',
            color: 'var(--v2-text)',
            boxShadow: 'var(--v2-shadow)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">☰</span>
          Menu
        </button>
      )}

      {isMobile && mobileView === 'menu' && (
        <MobileMenuScreen
          navItems={NAV_ITEMS}
          activeScreen={v2Screen}
          onSelectScreen={setV2Screen}
          clientes={clientes}
          selectedClienteId={selectedClienteId}
          onSelectCliente={handleMobileSelectCliente}
          initialAppearance={initialAppearance}
        />
      )}

      {isMobile && (
        <MobileChatSheet
          open={mobileView === 'chatModal'}
          onClose={() => setMobileView('menu')}
          projects={projects}
          activeSessionKey={activeSessionKey}
          activeSessions={activeSessions}
          persistedSessions={persistedSessions}
          selectedClienteId={selectedClienteId}
          onSelectChat={handleMobileSelectChat}
          onRenameChat={renameSession}
          onCloseChat={handleCloseChat}
          onStartNewChat={handleMobileStartNewChat}
        />
      )}
    </div>
  );
}
