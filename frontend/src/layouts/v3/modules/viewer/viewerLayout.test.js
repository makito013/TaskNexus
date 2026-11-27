import { describe, it, expect } from 'vitest'
import {
  SURFACE_CHAT,
  SURFACE_ARTIFACTS,
  SURFACE_CARD_ATTACHMENTS,
  DOCK_MIN_VIEWPORT,
  CHAT_DRAWER_MIN_VIEWPORT,
  ARTIFACTS_DRAWER_MIN_VIEWPORT,
  CONVERSATION_MIN_WIDTH,
  DEFAULT_DOCK_WIDTH,
  resolveViewerMode,
  resolveChatDock,
} from './viewerLayout.js'

describe('resolveViewerMode', () => {
  it('chat: dock from 1280, drawer from 768, full screen below', () => {
    const mode = (viewportWidth) => resolveViewerMode({ surface: SURFACE_CHAT, viewportWidth })
    expect(mode(1920)).toBe('dock')
    expect(mode(DOCK_MIN_VIEWPORT)).toBe('dock')
    expect(mode(DOCK_MIN_VIEWPORT - 1)).toBe('drawer')
    expect(mode(CHAT_DRAWER_MIN_VIEWPORT)).toBe('drawer')
    expect(mode(CHAT_DRAWER_MIN_VIEWPORT - 1)).toBe('fullscreen')
    expect(mode(390)).toBe('fullscreen')
  })

  it('artifacts: dock from 1280, drawer from 1024', () => {
    const mode = (viewportWidth) => resolveViewerMode({ surface: SURFACE_ARTIFACTS, viewportWidth })
    expect(mode(1280)).toBe('dock')
    expect(mode(1279)).toBe('drawer')
    expect(mode(ARTIFACTS_DRAWER_MIN_VIEWPORT)).toBe('drawer')
  })

  it('card attachments are always full screen', () => {
    for (const viewportWidth of [390, 768, 1024, 1280, 1920]) {
      expect(resolveViewerMode({ surface: SURFACE_CARD_ATTACHMENTS, viewportWidth })).toBe('fullscreen')
    }
  })

  it('a surface the user put in full screen is full screen at any width', () => {
    for (const surface of [SURFACE_CHAT, SURFACE_ARTIFACTS]) {
      for (const viewportWidth of [390, 1024, 1279, 1280, 1920]) {
        expect(resolveViewerMode({ surface, viewportWidth, fullscreen: true })).toBe('fullscreen')
      }
    }
  })

  it('an unknown surface is treated like the chat', () => {
    expect(resolveViewerMode({ surface: 'other', viewportWidth: 1500 })).toBe('dock')
    expect(resolveViewerMode({ surface: 'other', viewportWidth: 900 })).toBe('drawer')
  })
})

describe('resolveChatDock', () => {
  const base = { listWidth: 272, gap: 16, dockWidth: DEFAULT_DOCK_WIDTH }

  it('keeps the list when the conversation still has 420', () => {
    // 1144 - (272 + 16) - (420 + 16) = 420
    expect(resolveChatDock({ ...base, contentWidth: 1144 })).toEqual({ mode: 'dock', collapseList: false, width: 420 })
  })

  it('collapses the list at 1280 (content 1132, the conversation would get 408)', () => {
    expect(resolveChatDock({ ...base, contentWidth: 1132 })).toEqual({ mode: 'dock', collapseList: true, width: 420 })
    expect(CONVERSATION_MIN_WIDTH).toBe(420)
  })

  it('draws a wide saved width only as far as it leaves 420 to the conversation, without the list', () => {
    // saved 900; without the list the dock may use 1132 - 16 - 420 = 696
    expect(resolveChatDock({ ...base, contentWidth: 1132, dockWidth: 900 }))
      .toEqual({ mode: 'dock', collapseList: true, width: 696 })
  })

  it('becomes a drawer only when even the minimum dock would squeeze the conversation', () => {
    // 360 + 16 + 420 = 796
    expect(resolveChatDock({ ...base, contentWidth: 796 }).mode).toBe('dock')
    expect(resolveChatDock({ ...base, contentWidth: 795 })).toEqual({ mode: 'drawer', collapseList: false, width: null })
  })

  it('freezes the mode while dragging, so the handle is never unmounted under the pointer', () => {
    const frozen = resolveChatDock({
      ...base, contentWidth: 700, dockWidth: 600, dragging: true, previousMode: 'dock',
    })
    expect(frozen.mode).toBe('dock')
    expect(frozen.width).toBe(360)
    expect(resolveChatDock({ ...base, contentWidth: 700, dockWidth: 600 }).mode).toBe('drawer')
  })

  it('dragging without a known previous mode follows the plain rule', () => {
    expect(resolveChatDock({ ...base, contentWidth: 700, dragging: true }).mode).toBe('drawer')
  })

  it('treats a null saved width as the default 420', () => {
    expect(resolveChatDock({ ...base, contentWidth: 1600, dockWidth: null }).width).toBe(420)
  })

  it('does not depend on the saved preference being rewritten (pure)', () => {
    const input = { ...base, contentWidth: 1132, dockWidth: 900 }
    const copy = { ...input }
    resolveChatDock(input)
    expect(input).toEqual(copy)
  })
})
