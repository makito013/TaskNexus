import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import { useMediaQuery } from '../../../../hooks/useMediaQuery.js'
import { api } from '../../../../services/api.js'
import { useIslandReport } from '../../IslandContext.jsx'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'
import { parseSessionKey } from '../projects/agentBoard.js'
import { agentInitials } from '../projects/AgentCard.jsx'
import { chatStateOf, chatTitle, islandFor } from './chatLabels.js'
import { useChatSessionContext } from './ChatSessionHost.jsx'
import ModelCard from './cards/ModelCard.jsx'
import ChatHeader from './ChatHeader.jsx'
import ChatList from './ChatList.jsx'
import Composer from './Composer.jsx'
import ConnectorsDialog from './ConnectorsDialog.jsx'
import EndChatDialog from './EndChatDialog.jsx'
import MessageList from './MessageList.jsx'
import NewChatDialog from './NewChatDialog.jsx'
import PendingStrip from './PendingStrip.jsx'
import PermissionCard from './PermissionCard.jsx'
import { UI_COMMAND_CARDS } from './slashCommands.js'
import StatusBanner, { FAILURE_BANNER_ID, FAILURE_BANNER_KINDS } from './StatusBanner.jsx'
import SwitchEngineDialog from './SwitchEngineDialog.jsx'
import { useChatCommands } from './useChatCommands.js'
import { useChatListActions } from './useChatListActions.js'
import { useFirstMessages } from './useFirstMessages.js'
import { useProjectName } from './useProjectName.js'
import { useStickToEnd } from './useStickToEnd.js'
import TerminalView from './terminal/TerminalView.jsx'
import ConversationsDialog from '../viewer/ConversationsDialog.jsx'
import FileLinkScope from '../viewer/FileLinkScope.jsx'
import FloatingFilesButton from '../viewer/FloatingFilesButton.jsx'
import ViewerSurface, { useChatViewerLayout } from '../viewer/ViewerSurface.jsx'
import { useViewerShell } from '../viewer/ViewerShell.jsx'
import { sessionScope } from '../../../../services/viewerApi.js'
import { PHONE_QUERY } from './viewport.js'
import './ChatScreen.css'

const REFUSED_STATES = ['not_found']
const WAITING_STATES = ['connecting', 'open', 'idle']

function ThreadSkeleton() {
  return (
    <div className="v3-chat-skeleton" role="status" aria-busy="true">
      <span className="v3-chat-sr-only">Abrindo a conversa…</span>
      <span className="v3-chat-skeleton__bubble v3-chat-skeleton__bubble--short" aria-hidden="true" />
      <span className="v3-chat-skeleton__bubble" aria-hidden="true" />
      <span className="v3-chat-skeleton__bubble v3-chat-skeleton__bubble--short" aria-hidden="true" />
    </div>
  )
}

function EmptyThread({ agentName }) {
  return (
    <div className="v3-chat-empty">
      <span className="v3-chat-avatar v3-chat-avatar--large" aria-hidden="true">{agentInitials(agentName)}</span>
      <h2 className="v3-chat-empty__title">Converse com {agentName}</h2>
      <p className="v3-chat-empty__text v3-type-body-sm">Escreva uma mensagem ou digite / para ver os comandos.</p>
    </div>
  )
}

// The agent list failed and nothing else says which motor shows this key: asking again is the only way out.
function AgentsFailed({ onRetry }) {
  return (
    <div className="v3-chat-state">
      <h1 className="v3-chat-state__title" tabIndex={-1}>Não foi possível abrir esta conversa.</h1>
      <p className="v3-chat-state__text v3-type-body-sm" role="alert">Não conseguimos carregar a lista de agentes.</p>
      <Button onClick={onRetry}>Tentar de novo</Button>
    </div>
  )
}

function NotFound({ onBack }) {
  return (
    <div className="v3-chat-state">
      <h1 className="v3-chat-state__title" tabIndex={-1}>Não encontramos esta conversa.</h1>
      <p className="v3-chat-state__text v3-type-body-sm">Ela pode ter sido encerrada.</p>
      <Button onClick={onBack}>Voltar para Projetos</Button>
    </div>
  )
}

// The key is a conversation of the terminal (V2): the R-AV dialog over this placeholder is what the
// user answers; Cancelar goes back to Projetos (L12, recommendation A) without touching the backend.
function InTerminal() {
  return (
    <div className="v3-chat-state">
      <h1 className="v3-chat-state__title" tabIndex={-1}>Esta conversa está no terminal.</h1>
      <p className="v3-chat-state__text v3-type-body-sm">Abra no chat para continuar daqui.</p>
    </div>
  )
}

const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key)

// Which motor shows this key (CA46, CA47; a key is never both). Only ONE of the two views is ever mounted:
//   'terminal'  an agent that is not Claude (codex, agy, the plain terminal), a Claude conversation the user sent
//               to the terminal (its chat row says engine 'pty', or the switch just answered)
//   'chat'      everything else; a Claude conversation of the V2 terminal (no chat row) takes the C4 path: the
//               chat socket is refused and the screen offers the R-AV dialog
//   'pending'   nothing trustworthy says which yet: the key has no chat row and the agent list is still loading,
//               FAILED to load, or the sessions poll has not answered once. The chat's frame shows its opening
//               skeleton (or, after a failed list, an error with "Tentar de novo") and never "not found", so a
//               terminal key does not flash a refusal. It NEVER falls to 'chat' on an unreliable input.
// `override` is what the last switch answered ('chat' | 'terminal'): it beats the poll, which lags behind.
// `agentsLoaded` is true only when the list ARRIVED (a failure is not a loaded list: the screen keeps the failure
// apart, in `agentsStatus`). `providerLoaded` is the sessions poll's first answer (defaults to true for callers
// that do not care): without a chat row, 'chat' is decided only with both.
export function visionOf({ override, meta, agent, agentsLoaded, providerLoaded = true }) {
  if (override === 'terminal') return 'terminal'
  if (override === 'chat') return 'chat'
  if (meta?.engine === 'pty') return 'terminal'
  if (agent && agent.ia !== 'claude') return 'terminal'
  if (meta) return 'chat'
  if (!agentsLoaded || !providerLoaded) return 'pending'
  return 'chat'
}

// Tells a conversation that lives in the terminal apart from one that does not exist, once the chat
// socket refused the key (close 4404): a live PTY is in the sessions poll (`engine: 'pty'`); a saved one
// is in GET /api/sessions/persisted (no parameter: only the PTY conversations).
//   -> 'idle' (nothing refused) | 'checking' | 'pty' | 'none'
function usePtyLookup(sessionKey, refused, livePty) {
  const [lookup, setLookup] = useState('idle')
  useEffect(() => {
    if (!refused) {
      setLookup('idle')
      return undefined
    }
    if (livePty) {
      setLookup('pty')
      return undefined
    }
    let cancelled = false
    setLookup('checking')
    api.fetchPersistedSessions().then(
      (saved) => {
        if (!cancelled) setLookup(hasOwn(saved, sessionKey) ? 'pty' : 'none')
      },
      () => {
        if (!cancelled) setLookup('none')
      },
    )
    return () => {
      cancelled = true
    }
  }, [refused, livePty, sessionKey])
  return refused && lookup === 'idle' ? 'checking' : lookup
}

// The chat route: list of the project's chats | the open conversation. The conversation state comes
// from ChatSessionHost (above <main>, so the socket survives a module switch); this component only
// shows it.
//
// On a phone (<= 767) the two are two VIEWS of one screen (Designer 10): the conversation, and the list
// (reached by "Voltar"). Both stay mounted and the stylesheet shows one: switching views never touches
// the socket (it lives in the host) nor the thread's scroll. The view is plain local state: it needs no
// provider because nothing outside this screen reads it.
function ChatView({ sessionKey, session, engineOverrides, setEngineOverride }) {
  const sessions = useProjectsSessions()
  const { chats, liveByKey, graceKeys, loaded, liveAvailable, refresh, openChat, registerCreated, setFocusedKey, goTo } = sessions
  const { state, connection } = session
  const [agents, setAgents] = useState([])
  // 'loading' | 'ok' | 'failed': a failed list is NOT a loaded one (it decides the motor of a key with no chat row).
  const [agentsStatus, setAgentsStatus] = useState('loading')
  const [agentsAttempt, setAgentsAttempt] = useState(0)
  const [endTarget, setEndTarget] = useState(null)
  const [modelOpen, setModelOpen] = useState(false)
  // null | { origin: 'menu' | 'banner' }: where the connectors dialog was opened from.
  const [connectors, setConnectors] = useState(null)
  // null | { key, direction: 'pty' | 'chat' }: the engine switch the user is confirming (Designer 8).
  const [switchDialog, setSwitchDialog] = useState(null)
  // Bumped when a switch to the chat answered: the effect below asks for a fresh chat socket AFTER the commit
  // that unmounted the terminal, so the two sockets are never alive at once (CA47).
  const [chatResume, setChatResume] = useState(0)
  const threadRef = useRef(null)
  const composerRef = useRef(null)
  const screenRef = useRef(null)
  // Which "Novo chat" dialog is open: a token per opening (null = none). A creation that answers after its
  // dialog was cancelled carries the OLD token, so it can never navigate nor close a later dialog.
  const [newChatToken, setNewChatToken] = useState(null)
  const activeNewChatRef = useRef(null)
  const newChatSeqRef = useRef(0)
  const previousViewRef = useRef('chat')
  const phone = useMediaQuery(PHONE_QUERY)
  const [view, setView] = useState('chat') // phone only: 'chat' | 'list'
  const actions = useChatListActions({ onChanged: refresh })

  // The list names the agents AND says which motor a key with no chat row uses (`ia`): a failure leaves the key
  // undecided (never the chat) until "Tentar de novo" asks again. The key's agent id is never a stand-in for `ia`.
  useEffect(() => {
    let cancelled = false
    api.fetchAgents().then(
      (list) => {
        if (cancelled) return
        setAgents(Array.isArray(list) ? list : [])
        setAgentsStatus('ok')
      },
      () => {
        if (!cancelled) setAgentsStatus('failed')
      },
    )
    return () => {
      cancelled = true
    }
  }, [agentsAttempt])
  const retryAgents = useCallback(() => {
    setAgentsStatus('loading')
    setAgentsAttempt((count) => count + 1)
  }, [])

  useEffect(() => {
    setFocusedKey(sessionKey)
    return () => setFocusedKey(null)
  }, [sessionKey, setFocusedKey])

  // The viewer opens a file by itself only while the conversation is on screen: on a phone the list is
  // the other view of this screen.
  const viewerShell = useViewerShell()
  const viewerLayout = useChatViewerLayout(screenRef)
  const [conversationsOpen, setConversationsOpen] = useState(false)
  const listFolded = Boolean(viewerLayout?.collapseList)
  useEffect(() => {
    if (!listFolded) setConversationsOpen(false)
  }, [listFolded])
  const setChatContentVisible = viewerShell?.setChatContentVisible
  useEffect(() => {
    if (!setChatContentVisible) return undefined
    setChatContentVisible(!phone || view === 'chat')
    return () => setChatContentVisible(true)
  }, [setChatContentVisible, phone, view])

  // "Ver" of a toast (the viewer shell raises the number): a phone that was showing the list goes back to the
  // conversation. The value at mount is not a request, only a later change is.
  const chatViewRequest = viewerShell?.chatViewRequest ?? 0
  const handledChatViewRef = useRef(chatViewRequest)
  useEffect(() => {
    if (handledChatViewRef.current === chatViewRequest) return
    handledChatViewRef.current = chatViewRequest
    if (phone) setView('chat')
  }, [chatViewRequest, phone])

  // The view that disappears takes the focus with it: land on the heading of the one that appears.
  useEffect(() => {
    if (previousViewRef.current === view) return
    previousViewRef.current = view
    const target = view === 'list' ? '.v3-chat-list__title' : '.v3-chat-header__title'
    screenRef.current?.querySelector(target)?.focus()
  }, [view])

  const meta = chats.find((chat) => chat.session_key === sessionKey) ?? null
  const parsed = parseSessionKey(sessionKey)
  const agentId = meta?.agent_id ?? parsed.agentId
  const agent = agents.find((candidate) => candidate.id === agentId) ?? null
  const agentName = agent?.nome ?? agentId ?? 'Agente'
  const engineOverride = engineOverrides[sessionKey] ?? null
  const vision = visionOf({
    override: engineOverride,
    meta,
    agent,
    agentsLoaded: agentsStatus === 'ok',
    providerLoaded: loaded,
  })
  const inTerminal = vision === 'terminal'
  // 'shell': codex, agy, the plain terminal. 'claude': a Claude conversation that lives in the terminal.
  const terminalKind = agent && agent.ia !== 'claude' ? 'shell' : 'claude'
  const projectRef = meta?.project_ref ?? parsed.projectKey
  const projectName = useProjectName(projectRef)
  const firstMessage = state.messages.find((item) => item.kind === 'user')?.text ?? ''
  const title = inTerminal ? meta?.display_name?.trim() || agentName : chatTitle(meta, firstMessage)

  const failureBanner = state.banner && FAILURE_BANNER_KINDS.includes(state.banner.kind) ? state.banner : null
  const visionPending = vision === 'pending'
  const notFound = !visionPending && REFUSED_STATES.includes(connection.state) && !graceKeys.includes(sessionKey)
  const loading = visionPending || (!state.replayComplete && !failureBanner && (WAITING_STATES.includes(connection.state) || graceKeys.includes(sessionKey)))
  const ptyLookup = usePtyLookup(sessionKey, notFound, liveByKey?.[sessionKey]?.engine === 'pty')
  const running = state.turn.running
  const pending = state.cards.filter((card) => card.status === 'pending')
  const commands = useChatCommands(sessionKey, state.commandsVersion)
  // "Enviar de novo" only while nothing else is in flight: during the opening replay, with no live socket
  // (reconnecting, offline), while a turn runs, or while the reducer is resyncing (`resyncing`: from the
  // lost connection until the replay of the next one completes, the window in which the replay may still
  // echo the message back). In any of those a second send could duplicate the message the server already
  // has (C4 review, ressalva 3 and L2#4; ratified option B of the C5 report).
  const canResend = state.replayComplete && connection.state === 'open' && !state.resyncing && !running
  // The thread element exists only when the conversation is shown (not the skeleton, the empty chat or
  // the refusals): the observer of the stick-to-end hook is attached again each time that flips.
  const emptyChat = state.replayComplete && state.messages.length === 0 && state.cards.length === 0 && !failureBanner
  useStickToEnd(threadRef, vision === 'chat' && !notFound && !loading && !emptyChat)

  const projectChats = useMemo(
    () => (meta ? chats.filter((chat) => chat.project_ref === projectRef) : chats),
    [chats, meta, projectRef],
  )
  const overrides = useMemo(
    () => ({
      [sessionKey]: { pendingCount: state.pendingCount, running, tool: state.turn.tool, attentionSeen: true },
    }),
    [sessionKey, state.pendingCount, running, state.turn.tool],
  )
  const knownFirstMessages = useFirstMessages(projectChats, sessionKey)
  const fallbackTitles = useMemo(
    () => ({ ...knownFirstMessages, [sessionKey]: firstMessage }),
    [knownFirstMessages, sessionKey, firstMessage],
  )

  const stateInfo = failureBanner
    ? { state: 'failed', label: 'Falhou ao iniciar', accent: 'danger', className: '' }
    : chatStateOf(meta ?? {}, overrides[sessionKey])

  const island = useMemo(
    () => islandFor({ agentName, pendingCount: state.pendingCount, running, failed: Boolean(failureBanner), notFound: notFound && ptyLookup === 'none' }),
    [agentName, state.pendingCount, running, failureBanner, notFound, ptyLookup],
  )
  useIslandReport('projects', island)

  // The poll caught up with the switch: its answer is the truth again.
  useEffect(() => {
    if (engineOverride && meta?.engine === (engineOverride === 'terminal' ? 'pty' : 'chat')) setEngineOverride(sessionKey, null)
  }, [engineOverride, meta?.engine, sessionKey, setEngineOverride])

  // Tells the host which motor this key shows: only the chat view gets a /ws/chat reader (one motor per key).
  // 'pending' reports nothing: a key never decided has no reader yet, and one decided before (the screen
  // came back from another module) keeps its reader, so the socket survives the return (CA38).
  const { reportVision } = session
  useEffect(() => {
    if (vision !== 'pending') reportVision?.(sessionKey, vision)
  }, [reportVision, sessionKey, vision])

  // The view that replaces the other (chat <-> terminal) takes the focus with it: the heading of the new one.
  const previousVisionRef = useRef(vision)
  useEffect(() => {
    if (previousVisionRef.current === vision) return
    const wasPending = previousVisionRef.current === 'pending'
    previousVisionRef.current = vision
    if (!wasPending) screenRef.current?.querySelector('.v3-chat-header__title')?.focus()
  }, [vision])

  // A switch to the chat answered and the terminal is gone: ask for the chat socket and a fresh poll.
  useEffect(() => {
    if (chatResume === 0) return
    registerCreated(sessionKey)
    session.retryNow()
    refresh()
    // Runs once per answered switch; the callbacks are the context's and may change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatResume])

  const send = useCallback(() => {
    if (session.send(session.draft)) session.setDraft('')
  }, [session])

  const focusComposer = useCallback(() => composerRef.current?.focus(), [])

  const viewPending = () => {
    const card = threadRef.current?.querySelector('[data-pending="true"]')
    if (!card) return
    card.scrollIntoView?.({ block: 'center' })
    card.focus()
  }

  // Esc interrupts a running turn from anywhere inside the panel. Whatever handles Esc itself
  // (a menu, a rename box, the reason box of a denial) stops it before it gets here. A <dialog> (the
  // approval sheet, connectors, end chat...) is a child of the panel in the DOM but its Esc belongs to
  // the dialog: it only closes it, so a key pressed inside one never interrupts the turn.
  const onPanelKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !running || state.turn.interrupting) return
    if (event.target instanceof Element && event.target.closest('dialog')) return
    event.preventDefault()
    session.interrupt()
  }

  const onBannerAction = (id) => {
    if (id === 'retry') session.open()
    else if (id === 'new_conversation') session.reset()
    else if (id === 'retry_now') session.retryNow()
    else if (id === 'connectors') setConnectors({ origin: 'banner' })
    else if (id === 'open_terminal') setSwitchDialog({ key: sessionKey, direction: 'pty' })
  }

  const onUiCommand = (name) => {
    if (UI_COMMAND_CARDS[name] === 'model') setModelOpen(true)
  }

  // A switch answered. To the terminal: the view of that key becomes the terminal (another key: open it). To the
  // chat (R-AV accepted): the conversation is a chat now; the chat socket gave up on this key (4404) or sits idle
  // and the poll does not know it yet, so the screen asks for a fresh socket and a fresh poll (`chatResume`).
  const finishSwitch = (key, result) => {
    const toTerminal = result?.engine === 'pty'
    setEngineOverride(key, toTerminal ? 'terminal' : 'chat')
    setSwitchDialog(null)
    if (key !== sessionKey) {
      registerCreated(key)
      openChat(key)
    } else if (!toTerminal) {
      setChatResume((count) => count + 1)
    }
    refresh()
  }
  const onSwitched = (result) => finishSwitch(sessionKey, result ?? { engine: 'chat' })

  // "Sair do terminal": the focus has to leave the terminal (xterm keeps Tab for itself). On a phone the list is
  // the other view; elsewhere the list is beside it, or folded away by the viewer dock (then "Conversas" opens).
  const exitTerminal = () => {
    if (phone) setView('list')
    else if (listFolded) setConversationsOpen(true)
    else screenRef.current?.querySelector('.v3-chat-list__title')?.focus()
  }

  const confirmEnd = async () => {
    const key = endTarget.session_key
    const ok = await actions.endChat(key)
    if (!ok) return
    setEndTarget(null)
    if (key === sessionKey) goTo('/projects')
  }

  const openNewChat = () => {
    newChatSeqRef.current += 1
    activeNewChatRef.current = newChatSeqRef.current
    setNewChatToken(newChatSeqRef.current)
  }
  const closeNewChat = () => {
    activeNewChatRef.current = null
    setNewChatToken(null)
  }

  // A dialog cancelled while its request was still out creates the chat all the same: it is registered
  // and listed, but the user said no, so the screen does not navigate to it (C4 review, L2#5) and does not
  // touch whatever dialog is open now (C5 review, ressalva 1): `token` is the one of the opening that asked.
  const onCreated = (key, token) => {
    const cancelled = activeNewChatRef.current !== token
    registerCreated(key)
    if (cancelled) {
      refresh()
      return
    }
    closeNewChat()
    openChat(key)
  }

  const onOpenFromList = (key) => {
    setConversationsOpen(false)
    if (phone && key === sessionKey) setView('chat')
    else openChat(key)
  }

  const chatList = (
    <ChatList
      chats={projectChats}
      activeKey={sessionKey}
      overrides={overrides}
      fallbackTitles={fallbackTitles}
      loaded={loaded}
      available={liveAvailable}
      actions={actions}
      onOpen={onOpenFromList}
      onNewChat={openNewChat}
      onEnd={(chat) => setEndTarget(chat)}
      onRetry={refresh}
      onLeave={phone ? () => goTo('/projects') : undefined}
      onOpenTerminal={(chat) => setSwitchDialog({ key: chat.session_key, direction: 'pty' })}
      onOpenChat={(chat) => setSwitchDialog({ key: chat.session_key, direction: 'chat' })}
    />
  )

  return (
    <section
      ref={screenRef}
      className="v3-chat"
      aria-label="Chat"
      data-session-key={sessionKey}
      data-view={view}
      style={viewerLayout?.sectionStyle}
      {...viewerLayout?.sectionProps}
    >
      {listFolded ? null : chatList}

      <div className="v3-chat-panel" onKeyDown={onPanelKeyDown}>
        {visionPending && agentsStatus === 'failed' ? (
          <AgentsFailed onRetry={retryAgents} />
        ) : inTerminal ? (
          <>
            <ChatHeader
              terminal
              title={title}
              agentName={agentName}
              projectName={projectName}
              model={null}
              mode={null}
              stateInfo={null}
              onEnd={() => setEndTarget(meta ?? { session_key: sessionKey, display_name: title })}
              onOpenChat={terminalKind === 'claude' ? () => setSwitchDialog({ key: sessionKey, direction: 'chat' }) : undefined}
              onBack={phone ? () => setView('list') : undefined}
              sessionKey={sessionKey}
              onOpenConversations={listFolded ? () => setConversationsOpen(true) : undefined}
            />
            <TerminalView
              sessionKey={sessionKey}
              agentName={agentName}
              folderLabel={projectName}
              kind={terminalKind}
              phone={phone}
              onOpenChat={() => setSwitchDialog({ key: sessionKey, direction: 'chat' })}
              onExit={exitTerminal}
            />
          </>
        ) : notFound ? (
          ptyLookup === 'pty' ? (
            <InTerminal />
          ) : ptyLookup === 'none' ? (
            <NotFound onBack={() => goTo('/projects')} />
          ) : (
            <ThreadSkeleton />
          )
        ) : (
          <>
            <ChatHeader
              title={title}
              agentName={agentName}
              projectName={projectName}
              model={state.model ?? meta?.model ?? null}
              mode={state.mode ?? meta?.permission_mode ?? 'default'}
              stateInfo={stateInfo}
              running={running}
              interrupting={state.turn.interrupting}
              renameError={actions.renameError === sessionKey}
              renameBusy={actions.busyKey === sessionKey}
              onRename={(name) => actions.renameChat(sessionKey, name)}
              disabled={Boolean(failureBanner)}
              onEnd={() => setEndTarget(meta ?? { session_key: sessionKey, display_name: title })}
              onInterrupt={session.interrupt}
              onOpenModel={() => setModelOpen(true)}
              onOpenConnectors={() => setConnectors({ origin: 'menu' })}
              onOpenTerminal={failureBanner?.kind === 'spawn_failed' ? undefined : () => setSwitchDialog({ key: sessionKey, direction: 'pty' })}
              onBack={phone ? () => setView('list') : undefined}
              sessionKey={sessionKey}
              onOpenConversations={listFolded ? () => setConversationsOpen(true) : undefined}
            />
            <StatusBanner banner={state.banner} connection={connection} canOpenConnectors canOpenTerminal onAction={onBannerAction} />
            {session.actionError ? (
              <p className="v3-msg v3-msg--err v3-chat-action-error" role="alert">
                Não foi possível concluir a ação. Tente de novo.
              </p>
            ) : null}
            {loading ? (
              <ThreadSkeleton />
            ) : emptyChat ? (
              <EmptyThread agentName={agentName} />
            ) : (
              <FileLinkScope sessionKey={sessionKey}>
                <MessageList
                  logRef={threadRef}
                  live={state.replayComplete}
                  messages={state.messages}
                  toolsById={state.toolsById}
                  cards={state.cards}
                  turn={state.turn}
                  lastTurn={state.lastTurn}
                  agentName={agentName}
                  onResend={canResend ? session.send : undefined}
                  renderCard={(card) => (
                    <PermissionCard
                      card={card}
                      agentName={agentName}
                      context={projectName}
                      decision={session.decisions[card.id]}
                      onDecide={session.decide}
                      focusAfterDecision={focusComposer}
                      phone={phone}
                    />
                  )}
                />
              </FileLinkScope>
            )}
            {modelOpen ? (
              <ModelCard
                currentModel={state.model ?? meta?.model ?? null}
                rejected={state.rejected}
                disabled={Boolean(failureBanner)}
                setModel={session.setModel}
                onClose={() => {
                  setModelOpen(false)
                  focusComposer()
                }}
              />
            ) : null}
            <PendingStrip count={state.pendingCount} firstKind={pending[0]?.kind} onView={viewPending} />
            <Composer
              ref={composerRef}
              value={session.draft}
              onChange={session.setDraft}
              onSend={send}
              onInterrupt={session.interrupt}
              running={running}
              interrupting={state.turn.interrupting}
              disabled={Boolean(failureBanner)}
              loading={loading}
              describedBy={FAILURE_BANNER_ID}
              commands={commands}
              onCommandsWanted={commands.request}
              onUiCommand={onUiCommand}
            />
          </>
        )}
        {viewerLayout?.phone ? <FloatingFilesButton sessionKey={sessionKey} /> : null}
      </div>

      {/* Siblings of the panel (in the React tree too): a key pressed in the viewer never reaches "Esc interrupts". */}
      <ViewerSurface
        layout={viewerLayout}
        scope={sessionScope(sessionKey)}
        returnFocusTo={() => screenRef.current?.querySelector('[data-viewer-button]')}
      />
      <ConversationsDialog
        open={listFolded && conversationsOpen}
        onClose={() => setConversationsOpen(false)}
        returnFocusTo={() => screenRef.current?.querySelector('.v3-chat-conversations-button')}
      >
        {chatList}
      </ConversationsDialog>

      {newChatToken !== null ? (
        <NewChatDialog
          key={newChatToken}
          projectRef={projectRef}
          projectName={projectName}
          onClose={closeNewChat}
          onCreated={(key) => onCreated(key, newChatToken)}
        />
      ) : null}
      {vision === 'chat' && notFound && ptyLookup === 'pty' ? (
        <SwitchEngineDialog sessionKey={sessionKey} onCancel={() => goTo('/projects')} onSwitched={onSwitched} />
      ) : null}
      {switchDialog ? (
        <SwitchEngineDialog
          key={`${switchDialog.direction}:${switchDialog.key}`}
          sessionKey={switchDialog.key}
          direction={switchDialog.direction}
          turnRunning={switchDialog.key === sessionKey && running}
          projectRef={chats.find((chat) => chat.session_key === switchDialog.key)?.project_ref ?? projectRef}
          onCancel={() => setSwitchDialog(null)}
          onSwitched={(result) => finishSwitch(switchDialog.key, result)}
        />
      ) : null}
      {connectors ? (
        <ConnectorsDialog
          agentId={agentId}
          agentName={agentName}
          returnFocusTo={connectors.origin === 'menu' ? () => document.querySelector('.v3-chat-header .v3-chat-menu__button') : null}
          onClose={() => setConnectors(null)}
        />
      ) : null}
      {endTarget ? (
        <EndChatDialog
          busy={actions.busyKey === endTarget.session_key}
          failed={actions.endError === endTarget.session_key}
          onConfirm={confirmEnd}
          onClose={() => setEndTarget(null)}
        />
      ) : null}
    </section>
  )
}

// What the last engine switch of each key answered ({ [key]: 'chat' | 'terminal' }). It lives here, above the
// per-key view, so "Abrir no terminal" on ANOTHER row of the list can open that key already as a terminal.
function useEngineOverrides() {
  const [overrides, setOverrides] = useState({})
  const setOverride = useCallback((key, value) => {
    setOverrides((current) => {
      if ((current[key] ?? null) === value) return current
      const next = { ...current }
      if (value === null) delete next[key]
      else next[key] = value
      return next
    })
  }, [])
  return [overrides, setOverride]
}

export default function ChatScreen({ sessionKey }) {
  const session = useChatSessionContext()
  const [engineOverrides, setEngineOverride] = useEngineOverrides()
  // The host adopts the route's key in an effect: for one render the key can still be the previous one.
  if (!session || session.sessionKey !== sessionKey) {
    return (
      <section className="v3-chat" aria-label="Chat" data-session-key={sessionKey}>
        <div className="v3-chat-panel">
          <ThreadSkeleton />
        </div>
      </section>
    )
  }
  return <ChatView key={sessionKey} sessionKey={sessionKey} session={session} engineOverrides={engineOverrides} setEngineOverride={setEngineOverride} />
}
