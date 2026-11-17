import { describe, it, expect } from 'vitest'
import { MAX_DIFF_LINES, MAX_LABEL_COMMAND, parseMcpTool, summarizeTool } from './toolSummaries.js'

describe('summarizeTool labels (Designer 4.3)', () => {
  it('names each known tool in pt-BR', () => {
    expect(summarizeTool('Read', { file_path: 'C:\\x\\app.py' })).toMatchObject({ label: 'Leu 1 arquivo', file: 'C:\\x\\app.py' })
    expect(summarizeTool('Edit', { file_path: '/a/b/app.py', old_string: 'a', new_string: 'b' })).toMatchObject({ label: 'Editou app.py', file: '/a/b/app.py' })
    expect(summarizeTool('MultiEdit', { file_path: '/a/b/app.py', edits: [] }).label).toBe('Editou app.py')
    expect(summarizeTool('Write', { file_path: 'C:\\x\\new.md', content: 'x' }).label).toBe('Escreveu new.md')
    expect(summarizeTool('Bash', { command: 'npm test' }).label).toBe('Rodou `npm test`')
    expect(summarizeTool('PowerShell', { command: 'Get-Date' }).label).toBe('Rodou `Get-Date`')
    expect(summarizeTool('Grep', { pattern: 'TODO' }).label).toBe('Buscou `TODO`')
    expect(summarizeTool('Glob', { pattern: '**/*.js' }).label).toBe('Buscou `**/*.js`')
    expect(summarizeTool('WebSearch', { query: 'vitest' }).label).toBe('Pesquisou na web')
    expect(summarizeTool('WebFetch', { url: 'https://x.dev' }).label).toBe('Pesquisou na web')
  })

  it('describes an unknown tool by name', () => {
    expect(summarizeTool('TodoWrite', { todos: [] })).toMatchObject({ label: 'Usou TodoWrite', request: { verb: 'usar', object: 'TodoWrite' }, command: null, file: null, connector: null, diff: null })
  })

  it('writes MCP tools as "Connector: action" and names the connector', () => {
    const summary = summarizeTool('mcp__claude_ai_Atlassian__searchJiraIssues', { jql: 'x' })
    expect(summary).toMatchObject({ label: 'Atlassian: searchJiraIssues', connector: 'Atlassian', request: { verb: 'usar', object: 'Atlassian › searchJiraIssues' } })
    expect(summarizeTool('mcp__escritorio-cards__criar_card', {}).connector).toBe('escritorio-cards')
    expect(parseMcpTool('mcp__only')).toBeNull()
    expect(parseMcpTool('Bash')).toBeNull()
  })

  it('never throws on missing or odd input', () => {
    for (const input of [undefined, null, 'text', 42, [], {}]) {
      for (const name of ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebFetch', 'mcp__a__b', 'Zed', '']) {
        const summary = summarizeTool(name, input)
        expect(typeof summary.label).toBe('string')
        expect(summary.label.length).toBeGreaterThan(0)
        expect(typeof summary.detail).toBe('string')
      }
    }
    expect(summarizeTool(undefined, {}).label).toBe('Usou ferramenta')
  })
})

describe('summarizeTool command (R-PERM)', () => {
  it('keeps the whole command while the label is clipped', () => {
    const command = `echo ${'x'.repeat(300)}\nsecond line`
    const summary = summarizeTool('Bash', { command })
    expect(summary.command).toBe(command)
    expect(summary.detail).toBe(command)
    expect(summary.request).toEqual({ verb: 'rodar', object: command })
    expect(summary.label.length).toBeLessThanOrEqual('Rodou ``'.length + MAX_LABEL_COMMAND)
    expect(summary.label.endsWith('…`')).toBe(true)
    expect(summary.label).not.toContain('\n')
  })

  it('has no command for other tools', () => {
    expect(summarizeTool('Read', { file_path: 'a' }).command).toBeNull()
  })
})

describe('summarizeTool text safety', () => {
  it('returns markup in the input as plain text, never as HTML', () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    for (const summary of [
      summarizeTool('Bash', { command: hostile }),
      summarizeTool('Write', { file_path: `${hostile}.js`, content: hostile }),
      summarizeTool('Mystery', { value: hostile }),
    ]) {
      // The markup survives verbatim (to be shown as text); nothing escapes or rewrites it.
      expect(JSON.stringify(summary)).toContain('<script>alert(1)</script>')
    }
    expect(summarizeTool('Bash', { command: hostile }).command).toBe(hostile)
    expect(summarizeTool('Mystery', { value: hostile }).detail).toContain(hostile.replace(/"/g, '\\"'))
  })
})

describe('summarizeTool diff', () => {
  it('builds remove lines then add lines for Edit', () => {
    const { diff } = summarizeTool('Edit', { file_path: 'a.py', old_string: 'a = 1\nb = 2', new_string: 'a = 10' })
    expect(diff).toEqual({
      lines: [
        { type: 'remove', text: 'a = 1' },
        { type: 'remove', text: 'b = 2' },
        { type: 'add', text: 'a = 10' },
      ],
      truncated: false,
    })
  })

  it('handles CRLF and a MultiEdit list', () => {
    const { diff } = summarizeTool('MultiEdit', {
      file_path: 'a',
      edits: [{ old_string: 'x\r\ny', new_string: 'z' }, { old_string: 'q', new_string: 'r' }],
    })
    expect(diff.lines.map((line) => `${line.type}:${line.text}`)).toEqual(['remove:x', 'remove:y', 'remove:q', 'add:z', 'add:r'])
  })

  it('turns Write content into add lines', () => {
    const { diff } = summarizeTool('Write', { file_path: 'a.txt', content: 'one\ntwo' })
    expect(diff.lines).toEqual([{ type: 'add', text: 'one' }, { type: 'add', text: 'two' }])
  })

  it('caps a huge diff and says so', () => {
    const content = Array.from({ length: MAX_DIFF_LINES + 50 }, (_, index) => `line ${index}`).join('\n')
    const { diff } = summarizeTool('Write', { file_path: 'big.txt', content })
    expect(diff.lines).toHaveLength(MAX_DIFF_LINES)
    expect(diff.truncated).toBe(true)
  })

  it('has no diff for an empty Edit and none for other tools', () => {
    expect(summarizeTool('Edit', { file_path: 'a' }).diff).toBeNull()
    expect(summarizeTool('Bash', { command: 'x' }).diff).toBeNull()
  })
})
