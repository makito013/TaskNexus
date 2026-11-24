import { summarizeTool } from '../../../../../utils/toolSummaries.js'
import '../ChatLeaf.css'

// One tool of the conversation as a foldable chip (Designer 4.3): every tool the agent used appears,
// with or without an approval card. The state is TEXT (the colour only helps). The input, the command
// and the result are plain text nodes, never markup.
//   tool: { id, name, input, status: running | waiting | done | failed | denied | cancelled, result }
const STATE_TEXT = {
  running: 'em execução',
  waiting: 'aguardando você',
  done: 'feito',
  failed: 'falhou',
  denied: 'negado',
  cancelled: 'cancelado',
}
const STATE_TONE = {
  running: 'neutral',
  waiting: 'fin',
  done: 'ok',
  failed: 'danger',
  denied: 'danger-outline',
  cancelled: 'neutral',
}

function ToolIcon({ name }) {
  const path = (() => {
    if (name === 'Bash' || name === 'PowerShell') return <path d="M4 5.5l4 4.5-4 4.5M10.5 14.5H16" />
    if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') return <path d="M4 16l1-4 8.5-8.5 3 3L8 15zM12 5l3 3" />
    if (name === 'Read') return <path d="M5 3.5h7l3 3v10H5zM12 3.5v3h3" />
    if (name === 'Grep' || name === 'Glob' || name === 'WebSearch' || name === 'WebFetch') {
      return <><circle cx="9" cy="9" r="5" /><path d="M13 13l3.5 3.5" /></>
    }
    return <path d="M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2" />
  })()
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="v3-chat-chip__icon">
      {path}
    </svg>
  )
}

export default function ToolChip({ tool }) {
  const summary = summarizeTool(tool.name, tool.input)
  const stateText = STATE_TEXT[tool.status] ?? STATE_TEXT.running
  const tone = STATE_TONE[tool.status] ?? 'neutral'
  const result = tool.result

  return (
    <details className={`v3-chat-chip v3-chat-chip--${tool.status}`} data-tool-id={tool.id}>
      <summary className="v3-chat-chip__summary">
        <span className="v3-chat-chip__chevron" aria-hidden="true" />
        <ToolIcon name={tool.name} />
        <span className="v3-chat-chip__label">{summary.label}</span>
        <span className="v3-chat-sr-only">, </span>
        <span className={`v3-chat-chip__state v3-chat-chip__state--${tone}`}>
          {tool.status === 'running' ? <span className="v3-chat-chip__spinner" aria-hidden="true" /> : null}
          {stateText}
        </span>
      </summary>
      <div className="v3-chat-chip__detail">
        <p className="v3-type-eyebrow v3-chat-chip__eyebrow">ENTRADA</p>
        <pre className="v3-chat-chip__block v3-type-mono-sm">{summary.detail || 'Sem entrada.'}</pre>
        {result ? (
          <>
            <p className="v3-type-eyebrow v3-chat-chip__eyebrow">RESULTADO</p>
            <pre className="v3-chat-chip__block v3-type-mono-sm">{result.content || result.summary || 'Sem resultado.'}</pre>
            {result.truncated ? <p className="v3-type-caption v3-chat-chip__note">Resultado resumido pelo chat.</p> : null}
          </>
        ) : null}
      </div>
    </details>
  )
}
