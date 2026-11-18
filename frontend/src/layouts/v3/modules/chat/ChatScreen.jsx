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
function ChatView({ sessionKey, session }) {
  const sessions = useProjectsSessions()
  const { chats, liveByKey, graceKeys, loaded, liveAvailable, refresh, openChat, registerCreated, setFocusedKey, goTo } = sessions
  const { state, connection } = session
  const [agents, setAgents] = useState([])
  const [endTarget, setEndTarget] = useState(null)
  const [modelOpen, setModelOpen] = useState(false)
  // null | { origin: 'menu' | 'banner' }: where the connectors dialog was opened from.
  const [connectors, setConnectors] = useState(null)
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

  // Agent names are cosmetic: when the list is unavailable the key's agent id stands in.
  useEffect(() => {
    let cancelled = false
    api.fetchAgents().then(
      (list) => {
        if (!cancelled) setAgents(Array.isArray(list) ? list : [])
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setFocusedKey(sessionKey)
    return () => setFocusedKey(null)
  }, [sessionKey, setFocusedKey])

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
  const agentName = agents.find((agent) => agent.id === agentId)?.nome ?? agentId ?? 'Agente'
  const projectRef = meta?.project_ref ?? parsed.projectKey
  const projectName = useProjectName(projectRef)
  const firstMessage = state.messages.find((item) => item.kind === 'user')?.text ?? ''
  const title = chatTitle(meta, firstMessage)

  const failureBanner = state.banner && FAILURE_BANNER_KINDS.includes(state.banner.kind) ? state.banner : null
  const notFound = REFUSED_STATES.includes(connection.state) && !graceKeys.includes(sessionKey)
  const loading = !state.replayComplete && !failureBanner && (WAITING_STATES.includes(connection.state) || graceKeys.includes(sessionKey))
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
  useStickToEnd(threadRef, !notFound && !loading && !emptyChat)

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
  }

  const onUiCommand = (name) => {
    if (UI_COMMAND_CARDS[name] === 'model') setModelOpen(true)
  }

  // R-AV accepted: the conversation is a chat now. The socket gave up on this key (4404) and the poll
  // does not know it yet, so the screen asks for a fresh socket and a fresh poll.
  const onSwitched = () => {
    registerCreated(sessionKey)
    session.retryNow()
    refresh()
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
    if (phone && key === sessionKey) setView('chat')
    else openChat(key)
  }

  return (
    <section ref={screenRef} className="v3-chat" aria-label="Chat" data-session-key={sessionKey} data-view={view}>
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
      />

      <div className="v3-chat-panel" onKeyDown={onPanelKeyDown}>
        {notFound ? (
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
              onBack={phone ? () => setView('list') : undefined}
            />
            <StatusBanner banner={state.banner} connection={connection} canOpenConnectors onAction={onBannerAction} />
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
      </div>

      {newChatToken !== null ? (
        <NewChatDialog
          key={newChatToken}
          projectRef={projectRef}
          projectName={projectName}
          onClose={closeNewChat}
          onCreated={(key) => onCreated(key, newChatToken)}
        />
      ) : null}
      {notFound && ptyLookup === 'pty' ? (
        <SwitchEngineDialog sessionKey={sessionKey} onCancel={() => goTo('/projects')} onSwitched={onSwitched} />
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

export default function ChatScreen({ sessionKey }) {
  const session = useChatSessionContext()
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
  return <ChatView key={sessionKey} sessionKey={sessionKey} session={session} />
}
