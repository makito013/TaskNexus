import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { installDialogElementStub } from '../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../hooks/useViewerContent.js'
import { routeForPath } from '../modules.js'
import { createHarness } from './viewer/viewerTestKit.jsx'

installDialogElementStub()
const { stubFetch, renderWithShell } = createHarness({ vi, render })
beforeEach(() => { vi.stubGlobal('WebSocket', class {}); clearViewerContentCache(); window.innerWidth = 1440 })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const VICTIM = 'Pessoal/tn-sandbox::claude::victim'
const link = (key) => `/projects/chat/${encodeURIComponent(key)}`

describe('chat route: a key with %2e dot-segments is no route', () => {
  it('routeForPath returns null for the encoded link', () => {
    expect(routeForPath(link(`Pessoal/tn-sandbox::claude::x/%2e%2e/%2e%2e/${VICTIM}`))).toBeNull()
    expect(routeForPath(link('a/%2E./b'))).toBeNull()
  })

  it('a %252e link decodes once into a %2e key and is refused too', () => {
    expect(routeForPath('/projects/chat/a/%252e%252e/b')).toBeNull()
    expect(routeForPath('/projects/chat/P%3A%3Aclaude%3A%3Ax%2F%252e%252e%2F%252e%252e%2Fvictim')).toBeNull()
  })

  it('a real key still routes', () => {
    expect(routeForPath(link(VICTIM))).toEqual({ moduleId: 'projects', view: 'chat', sessionKey: VICTIM })
  })

  it('the ViewerShell with such a key makes no request at all', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { activeSessionKey: `P::claude::x/%2e%2e/%2e%2e/${VICTIM}` })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
