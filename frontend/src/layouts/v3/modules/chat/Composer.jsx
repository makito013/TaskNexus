import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import { useMediaQuery } from '../../../../hooks/useMediaQuery.js'
import SlashMenu, { SLASH_LIST_ID, slashOptionId } from './SlashMenu.jsx'
import { UI_COMMAND_CARDS, commandNameOf, matchCommands } from './slashCommands.js'
import { NARROW_SHELL_QUERY } from './viewport.js'

const MAX_ROWS = 6
const SLASH_TEXT = /^\/[^\s]*$/

// `text-overflow` does nothing on ::placeholder, so a text that does not fit is cut mid-word. On a narrow
// shell (<= 1279: phone and iPad, with "Interromper" beside it) a short text is shown that fits whole
// (Designer C5, A1); the long one stays from 1280. The aria-label is the same either way.
const PLACEHOLDER = 'Mensagem para o agente, ou / para comandos'
const PLACEHOLDER_NARROW = 'Mensagem ou / para comandos'

// Composer of the chat (Designer 7): a textarea that is also the combobox of the "/" menu (the focus
// never leaves it; the menu is read through aria-activedescendant), the send / interrupt button and the
// hints line. No attachment button.
//   value / onChange   the draft (kept per chat by useChatSession)
//   onSend()           Enter (Shift+Enter breaks the line)
//   onInterrupt()      the stop button while a turn runs
//   running            a turn is running: Enviar becomes Interromper and Enter does not send
//   disabled           the chat refused (spawn/resume/engine): readonly, aria-disabled, placeholder
//   loading            the conversation is still opening: readonly and aria-disabled, usual placeholder
//   describedBy        id of the banner that explains why
//   commands           { status: idle|loading|ready|error, items } of useChatCommands (items are the selectable ones)
//   onCommandsWanted() the menu opened for the first time: the screen starts reading the commands
//   onUiCommand(name)  a `handling: "ui"` command was chosen or typed: the screen opens its card (the text is
//                      cleared here and never sent: the server would refuse it)
// Keys with the menu open and rows to pick: Up/Down walk (wrapping), Enter and Tab pick, Esc closes it keeping
// the text. Esc with no menu is left alone: the screen interrupts the turn with it.
const Composer = forwardRef(function Composer(
  {
    value,
    onChange,
    onSend,
    onInterrupt,
    running = false,
    interrupting = false,
    disabled = false,
    loading = false,
    describedBy,
    commands = { status: 'idle', items: [] },
    onCommandsWanted,
    onUiCommand,
  },
  forwardedRef,
) {
  const innerRef = useRef(null)
  const [dismissedFor, setDismissedFor] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [argHint, setArgHint] = useState(null)
  const narrow = useMediaQuery(NARROW_SHELL_QUERY)
  const empty = value.trim() === ''
  const locked = disabled || loading

  const setRef = (node) => {
    innerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  const wantsMenu = !locked && SLASH_TEXT.test(value)
  const open = wantsMenu && dismissedFor !== value
  const query = wantsMenu ? value.slice(1) : ''
  const match = useMemo(() => matchCommands(commands.items, query), [commands.items, query])
  const navigable = open && commands.status === 'ready' && match.flat.length > 0
  const active = navigable ? Math.min(activeIndex, match.flat.length - 1) : -1

  useEffect(() => {
    if (wantsMenu) onCommandsWanted?.()
  }, [wantsMenu, onCommandsWanted])
  useEffect(() => {
    setActiveIndex(0)
  }, [query])
  // The hint of a command's argument lives only while the text still starts with that command.
  useEffect(() => {
    if (argHint && !value.startsWith(`/${argHint.name} `)) setArgHint(null)
  }, [value, argHint])

  const rows = Math.min(MAX_ROWS, Math.max(1, value.split('\n').length))

  const runUi = (name) => {
    onChange('')
    onUiCommand?.(name)
  }

  const choose = (index) => {
    const item = match.flat[index]
    if (!item) return
    if (item.handling === 'ui') {
      runUi(item.name)
      return
    }
    onChange(`/${item.name} `)
    setArgHint(item.argumentHint ? { name: item.name, text: item.argumentHint } : null)
    innerRef.current?.focus()
  }

  // Enter, or the send button: a typed ui command opens its card; anything else is sent.
  const submit = () => {
    if (locked) return
    const typed = commandNameOf(value)
    if (typed && UI_COMMAND_CARDS[typed] && commands.items.some((item) => item.name === typed && item.handling === 'ui')) {
      runUi(typed)
      return
    }
    if (!running && !empty) onSend()
  }

  const onKeyDown = (event) => {
    if (event.nativeEvent?.isComposing) return
    if (open) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedFor(value)
        return
      }
      if (navigable) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActiveIndex((active + step + match.flat.length) % match.flat.length)
          return
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault()
          choose(active)
          return
        }
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <div className="v3-chat-composer">
      {open ? (
        <SlashMenu status={commands.status} match={match} query={query} activeIndex={active} onChoose={choose} />
      ) : null}
      <div className="v3-chat-composer__box">
        <textarea
          ref={setRef}
          className="v3-chat-composer__input"
          rows={rows}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={navigable ? SLASH_LIST_ID : undefined}
          aria-activedescendant={navigable ? slashOptionId(active) : undefined}
          aria-label="Mensagem para o agente"
          aria-describedby={disabled ? describedBy : undefined}
          aria-disabled={locked ? 'true' : undefined}
          readOnly={locked}
          placeholder={disabled ? 'Chat indisponível. Veja o aviso acima.' : narrow ? PLACEHOLDER_NARROW : PLACEHOLDER}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <Button
            className="v3-chat-composer__send v3-chat-stop"
            aria-label={interrupting ? 'Interrompendo turno' : 'Interromper turno'}
            aria-busy={interrupting ? 'true' : undefined}
            aria-disabled={interrupting ? 'true' : undefined}
            onClick={() => !interrupting && onInterrupt()}
          >
            {interrupting ? 'Interrompendo…' : 'Interromper'}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="v3-chat-composer__send"
            aria-label="Enviar mensagem"
            aria-disabled={empty || locked ? 'true' : undefined}
            onClick={() => !empty && !locked && submit()}
          >
            Enviar
          </Button>
        )}
      </div>
      {argHint ? (
        <p className="v3-chat-composer__note v3-type-caption">
          Argumento: <span className="v3-chat-composer__arg v3-type-mono-sm">{argHint.text}</span>
        </p>
      ) : null}
      {running ? <p className="v3-chat-composer__note v3-type-caption">Aguardando a resposta. Esc interrompe.</p> : null}
      {disabled && !empty ? (
        <p className="v3-chat-composer__note v3-type-caption">Rascunho guardado. O envio volta quando reconectar.</p>
      ) : null}
      <p className="v3-chat-composer__hints v3-type-caption">
        <kbd className="v3-chat-kbd">/</kbd> comandos · <kbd className="v3-chat-kbd">Enter</kbd> envia ·{' '}
        <kbd className="v3-chat-kbd">Shift</kbd>+<kbd className="v3-chat-kbd">Enter</kbd> nova linha ·{' '}
        <kbd className="v3-chat-kbd">Esc</kbd> interrompe
      </p>
    </div>
  )
})

export default Composer
