import Chip from '../../components/Chip/Chip.jsx'
import { originLabel } from './slashCommands.js'

export const SLASH_LIST_ID = 'chat-slash-list'
export const slashOptionId = (index) => `chat-slash-opt-${index}`

function CardIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false" className="v3-chat-slash__card-icon">
      <rect x="3.5" y="4.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 8.5h13" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function Option({ item, index, active, onChoose }) {
  return (
    <div
      id={slashOptionId(index)}
      role="option"
      aria-selected={active}
      className={`v3-chat-slash__option${active ? ' v3-chat-slash__option--active' : ''}`}
      // The textarea keeps the focus: pressing an option must not take it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(index)}
    >
      <span className="v3-chat-slash__name v3-type-mono-sm">/{item.name}</span>
      {item.handling === 'ui' ? (
        <span className="v3-chat-slash__ui" title="abre um cartão">
          <CardIcon />
          <span className="v3-chat-sr-only">abre um cartão</span>
        </span>
      ) : null}
      <span className="v3-chat-slash__desc v3-type-body-sm">{item.description}</span>
      {item.argumentHint ? <span className="v3-chat-slash__arg v3-type-mono-sm">{item.argumentHint}</span> : null}
      <Chip tone="badge" className="v3-chat-slash__origin">{originLabel(item)}</Chip>
    </div>
  )
}

// The "/" menu (Designer 7.2): NOT modal, the focus stays in the textarea, which points at the
// active row through aria-activedescendant. With an empty search the rows are grouped by origin;
// with text they are one list by relevance. It only renders; the composer owns the keys.
//   status   idle | loading | ready | error     match  { flat, groups }     query  what follows the "/"
//   activeIndex  position in match.flat         onChoose(index)
export default function SlashMenu({ status, match, query, activeIndex, onChoose }) {
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="v3-chat-slash" role="status" aria-busy="true">
        <p className="v3-chat-slash__state v3-type-body-sm">Carregando comandos…</p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="v3-chat-slash" role="status">
        <p className="v3-chat-slash__state v3-type-body-sm">
          Não foi possível carregar os comandos. Você ainda pode enviar a mensagem como texto.
        </p>
      </div>
    )
  }
  if (match.flat.length === 0) {
    return (
      <div className="v3-chat-slash" role="status">
        <p className="v3-chat-slash__state v3-type-body-sm">{`Nenhum comando encontrado para “/${query}”.`}</p>
      </div>
    )
  }

  let cursor = 0
  const render = (item) => {
    const index = cursor
    cursor += 1
    return <Option key={item.name} item={item} index={index} active={index === activeIndex} onChoose={onChoose} />
  }
  return (
    <div className="v3-chat-slash">
      <div id={SLASH_LIST_ID} role="listbox" aria-label="Comandos" className="v3-chat-slash__list">
        {match.groups
          ? match.groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="v3-chat-slash__group">
              <span className="v3-chat-slash__eyebrow v3-type-eyebrow" aria-hidden="true">{group.label}</span>
              {group.items.map(render)}
            </div>
          ))
          : match.flat.map(render)}
      </div>
    </div>
  )
}
