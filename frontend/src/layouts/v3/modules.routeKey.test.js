import { describe, it, expect } from 'vitest'
import { pushSessionKey, routeForPath } from './modules.js'

describe('routeForPath refuses a key that cannot be a session key (stage 10, Y3)', () => {
  it.each([
    '..', '../other::claude::x', 'proj/../other::claude', '%2e%2e', 'proj/%2E%2E/x', 'proj/./x', 'a//b',
    'proj::claude%3Fx=1', 'proj::claude%23f', 'proj%5Cx::claude', 'proj::claude%00', 'proj::claude%0A',
  ])('%s is no route', (encoded) => {
    expect(routeForPath(`/projects/chat/${encoded}`)).toBeNull()
  })

  it('an encoded slash inside one segment still gives the sub-project key', () => {
    const key = 'Pessoal/tn-sandbox::claude::ab12cd'
    expect(routeForPath(`/projects/chat/${encodeURIComponent(key)}`)).toEqual({ moduleId: 'projects', view: 'chat', sessionKey: key })
  })

  it('the key of a push link is refused the same way', () => {
    expect(pushSessionKey('/', '?session=proj%2F..%2Fx')).toBeNull()
    expect(pushSessionKey('/', '?session=..')).toBeNull()
    expect(pushSessionKey('/', '?session=proj%3A%3Aclaude')).toBe('proj::claude')
  })
})
