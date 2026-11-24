import { describe, it, expect } from 'vitest'
import { moduleForPath, routeForPath } from './modules.js'

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'

describe('routeForPath', () => {
  it('resolves the chat route and decodes the key once', () => {
    expect(routeForPath(`/projects/chat/${encodeURIComponent(KEY)}`)).toEqual({
      moduleId: 'projects',
      view: 'chat',
      sessionKey: KEY,
    })
  })

  it('ignores a trailing slash', () => {
    expect(routeForPath('/projects/chat/abc/')).toEqual({ moduleId: 'projects', view: 'chat', sessionKey: 'abc' })
    expect(routeForPath('/projects/chat/abc///')).toMatchObject({ sessionKey: 'abc' })
  })

  it('does not decode a second time', () => {
    expect(routeForPath('/projects/chat/a%2520b').sessionKey).toBe('a%20b')
  })

  it('keeps raw slashes of the key', () => {
    expect(routeForPath('/projects/chat/Pessoal/tn::claude').sessionKey).toBe('Pessoal/tn::claude')
  })

  it('is null for an empty key', () => {
    expect(routeForPath('/projects/chat/')).toBeNull()
    expect(routeForPath('/projects/chat')).toBeNull()
    expect(routeForPath('/projects/chat//')).toBeNull()
  })

  it('is null for a malformed escape', () => {
    expect(routeForPath('/projects/chat/%E0%A4%A')).toBeNull()
  })

  it('answers like moduleForPath for every other path', () => {
    expect(routeForPath('/projects')).toEqual({ moduleId: 'projects', view: 'screen', sessionKey: null })
    expect(routeForPath('/projects/')).toEqual({ moduleId: 'projects', view: 'screen', sessionKey: null })
    expect(routeForPath('/tasks')).toEqual({ moduleId: 'tasks', view: 'screen', sessionKey: null })
    for (const path of ['/', '/tarefas', '/dev/gallery', '/projects/chatty', '/projects/other', '/chat/abc']) {
      expect(routeForPath(path)).toBeNull()
      expect(moduleForPath(path)).toBeNull()
    }
  })

  it('leaves moduleForPath untouched: the chat path is not a module path', () => {
    expect(moduleForPath('/projects/chat/abc')).toBeNull()
  })
})
