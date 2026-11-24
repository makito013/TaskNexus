import { describe, it, expect } from 'vitest'
import { createChatState, reduceChat, reduceChatEvents } from './chatEvents.js'

const KEY = 'p::claude::abc123'
const frame = (type, seq, payload = {}) => ({ type, session_key: KEY, seq, ts: 1000 + seq, ...payload })
const sent = (state, id, text) => reduceChat(state, { type: 'local.send', client_msg_id: id, request_id: `r-${id}`, text })

describe('a message that was still "Enviando…" when the process failed to start', () => {
  it.each(['resume_failed', 'engine_unavailable', 'spawn_failed'])('becomes "failed" on %s', (code) => {
    let state = sent(createChatState(), 'c1', 'oi')
    expect(state.messages[0].status).toBe('sending')
    state = reduceChat(state, frame('status', 5, { code, detail: 'x' }))
    expect(state.messages[0]).toMatchObject({ status: 'failed', errorCode: code })
    expect(state.banner.kind).toBe(code)
  })

  it('leaves messages that were already sent alone and only fails the pending ones', () => {
    let state = reduceChatEvents(createChatState(), [frame('message.user', 1, { client_msg_id: 'c0', text: 'antes', origin: 'ui' })])
    state = sent(state, 'c1', 'depois')
    state = reduceChat(state, frame('status', 6, { code: 'resume_failed' }))
    expect(state.messages.map((item) => item.status)).toEqual(['sent', 'failed'])
  })

  it('a status that is not a failure keeps the message sending', () => {
    let state = sent(createChatState(), 'c1', 'oi')
    state = reduceChat(state, frame('status', 2, { code: 'closed', reason: 'idle' }))
    expect(state.messages[0].status).toBe('sending')
  })
})
