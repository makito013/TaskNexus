import { describe, it, expect } from 'vitest'
import { citeTargetsFor } from './citeTargets.js'

const target = { project_id: 'Pessoal/tn-sandbox', path: 'docs/a.md' }
const chat = (key, extra = {}) => ({
  session_key: key, project_ref: 'Pessoal/tn-sandbox', display_name: null, status: 'active', live_status: 'idle', ...extra,
})
const KEY_A = 'Pessoal/tn-sandbox::claude::aaa'
const KEY_B = 'Pessoal/tn-sandbox::claude::bbb'

describe('citeTargetsFor', () => {
  it('lists the conversations of the project of the artifact, titled by name or by the default', () => {
    const targets = citeTargetsFor(target, {
      chats: [chat(KEY_A, { display_name: 'Revisão' }), chat(KEY_B), chat('Other/x::claude::z', { project_ref: 'Other/x' })],
    })
    expect(targets).toEqual([
      { sessionKey: KEY_A, kind: 'chat', label: 'Revisão' },
      { sessionKey: KEY_B, kind: 'chat', label: 'Nova conversa' },
    ])
  })

  it('keeps a resumable chat (no live status) and drops one that failed to start', () => {
    const targets = citeTargetsFor(target, {
      chats: [chat(KEY_A, { live_status: null, status: 'idle' }), chat(KEY_B, { live_status: null, status: 'failed' })],
    })
    expect(targets.map((entry) => entry.sessionKey)).toEqual([KEY_A])
  })

  it('adds the live terminal sessions of the project, never a chat twice and never another project', () => {
    const targets = citeTargetsFor(target, {
      chats: [chat(KEY_A)],
      liveByKey: {
        [KEY_A]: { engine: 'chat' },
        'Pessoal/tn-sandbox::codex::t1': { engine: 'pty', status: 'running' },
        'Pessoal/tn-sandbox::shell::t2': { engine: 'chat' },
        'Other/x::codex::t3': { engine: 'pty' },
      },
    })
    expect(targets).toEqual([
      { sessionKey: KEY_A, kind: 'chat', label: 'Nova conversa' },
      { sessionKey: 'Pessoal/tn-sandbox::codex::t1', kind: 'terminal', label: 'Terminal de codex' },
    ])
  })

  it('a session with no engine tag is not a terminal', () => {
    expect(citeTargetsFor(target, { liveByKey: { 'Pessoal/tn-sandbox::codex::t1': { status: 'running' } } })).toEqual([])
  })

  it('no project on the artifact, no sessions or nothing passed: no target', () => {
    expect(citeTargetsFor({ path: 'a.md' }, { chats: [chat(KEY_A)] })).toEqual([])
    expect(citeTargetsFor(target)).toEqual([])
    expect(citeTargetsFor(null, {})).toEqual([])
    expect(citeTargetsFor(target, { chats: [], liveByKey: null })).toEqual([])
  })

  it('a chat is matched by the EXACT project, not by a prefix', () => {
    const targets = citeTargetsFor({ project_id: 'Pessoal/tn' }, { chats: [chat(KEY_A)] })
    expect(targets).toEqual([])
  })
})
