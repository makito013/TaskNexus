// Human summary of a tool call of the chat, for the chips of the thread and the approval cards
// (Designer 4.3 and 5.1). Pure: never touches the DOM and never returns HTML. Every string is
// plain text for the UI to render as text (textContent), whatever the tool input holds.
//
//   summarizeTool(toolName, input) -> {
//     label:     chip text, pt-BR ("Rodou `npm test`", "Editou app.py", "Leu 1 arquivo")
//     request:   { verb, object } for the card sentence "{Agent} quer {verb} {object}"
//     detail:    plain text of the input for the "ENTRADA" block
//     command:   the FULL command of Bash/PowerShell (never clipped), else null
//     file:      the file path of Read/Edit/Write, else null
//     connector: the connector name of an MCP tool, else null
//     diff:      { lines: [{ type: 'add' | 'remove', text }], truncated } for Edit/Write, else null
//   }
export const MAX_LABEL_COMMAND = 80
export const MAX_DIFF_LINES = 500

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const FILE_EDIT_TOOLS = new Set(['Edit', 'MultiEdit'])

function asObject(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function baseName(path) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

function clip(text, max) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

function splitLines(text) {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n')
}

function buildDiff(removed, added) {
  const lines = [
    ...removed.flatMap(splitLines).map((text) => ({ type: 'remove', text })),
    ...added.flatMap(splitLines).map((text) => ({ type: 'add', text })),
  ]
  if (lines.length === 0) return null
  return lines.length > MAX_DIFF_LINES
    ? { lines: lines.slice(0, MAX_DIFF_LINES), truncated: true }
    : { lines, truncated: false }
}

// "mcp__claude_ai_Atlassian__searchJira" -> { server: 'Atlassian', action: 'searchJira' }
export function parseMcpTool(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null
  const [server, ...rest] = toolName.slice(5).split('__')
  const action = rest.join('__')
  if (!server || !action) return null
  return { server: server.replace(/^claude_ai_/, '').replace(/_/g, ' '), action }
}

function prettyInput(input) {
  try {
    return JSON.stringify(input ?? null, null, 2) ?? ''
  } catch {
    return String(input)
  }
}

function result(fields) {
  return {
    label: '',
    request: { verb: 'usar', object: null },
    detail: '',
    command: null,
    file: null,
    connector: null,
    diff: null,
    ...fields,
  }
}

export function summarizeTool(toolName, input) {
  const data = asObject(input)
  const name = asText(toolName) || 'ferramenta'

  if (SHELL_TOOLS.has(name)) {
    const command = asText(data.command)
    return result({
      label: command ? `Rodou \`${clip(command, MAX_LABEL_COMMAND)}\`` : 'Rodou um comando',
      request: { verb: 'rodar', object: command || null },
      detail: command,
      command: command || null,
    })
  }

  if (name === 'Read') {
    const file = asText(data.file_path)
    return result({
      label: 'Leu 1 arquivo',
      request: { verb: 'ler', object: file || null },
      detail: file,
      file: file || null,
    })
  }

  if (FILE_EDIT_TOOLS.has(name)) {
    const file = asText(data.file_path)
    const edits = Array.isArray(data.edits) ? data.edits.map(asObject) : [data]
    const diff = buildDiff(
      edits.map((edit) => asText(edit.old_string)),
      edits.map((edit) => asText(edit.new_string)),
    )
    return result({
      label: file ? `Editou ${baseName(file)}` : 'Editou um arquivo',
      request: { verb: 'editar', object: file || null },
      detail: file,
      file: file || null,
      diff,
    })
  }

  if (name === 'Write') {
    const file = asText(data.file_path)
    return result({
      label: file ? `Escreveu ${baseName(file)}` : 'Escreveu um arquivo',
      request: { verb: 'escrever', object: file || null },
      detail: file,
      file: file || null,
      diff: buildDiff([], [asText(data.content)]),
    })
  }

  if (name === 'Grep' || name === 'Glob') {
    const pattern = asText(data.pattern)
    return result({
      label: pattern ? `Buscou \`${clip(pattern, MAX_LABEL_COMMAND)}\`` : 'Buscou nos arquivos',
      request: { verb: 'buscar', object: pattern || null },
      detail: pattern,
    })
  }

  if (name === 'WebSearch' || name === 'WebFetch') {
    const target = asText(data.query) || asText(data.url)
    return result({
      label: 'Pesquisou na web',
      request: { verb: 'pesquisar na web', object: target || null },
      detail: target,
    })
  }

  const mcp = parseMcpTool(name)
  if (mcp) {
    return result({
      label: `${mcp.server}: ${mcp.action}`,
      request: { verb: 'usar', object: `${mcp.server} › ${mcp.action}` },
      detail: prettyInput(input),
      connector: mcp.server,
    })
  }

  return result({
    label: `Usou ${name}`,
    request: { verb: 'usar', object: name },
    detail: prettyInput(input),
  })
}
