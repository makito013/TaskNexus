// Pure layout rules of the V3 file viewer: which presentation a surface gets at a width, and how the
// chat column makes room for the dock. No DOM, no state: the shell feeds it measured numbers.
import { DOCK_MIN_WIDTH } from '../../../../hooks/useDockWidth.js'

export const SURFACE_CHAT = 'chat'
export const SURFACE_ARTIFACTS = 'artefatos'
export const SURFACE_CARD_ATTACHMENTS = 'card-attachments'

// Viewport breakpoints (05 section 3.3, K6). The phone query of the chat is `max-width: 767px`.
export const DOCK_MIN_VIEWPORT = 1280
export const CHAT_DRAWER_MIN_VIEWPORT = 768
export const ARTIFACTS_DRAWER_MIN_VIEWPORT = 1024

// The conversation column never gets narrower than this next to a dock (a structural literal).
export const CONVERSATION_MIN_WIDTH = 420
export const DEFAULT_DOCK_WIDTH = 420

/**
 * @param {{ surface: string, viewportWidth: number, fullscreen?: boolean }} input
 *   `fullscreen` is the user's choice (the expand button): it wins at any width.
 * @returns {'dock' | 'drawer' | 'fullscreen'}
 */
export function resolveViewerMode({ surface, viewportWidth, fullscreen = false }) {
  if (surface === SURFACE_CARD_ATTACHMENTS || fullscreen) return 'fullscreen'
  if (viewportWidth >= DOCK_MIN_VIEWPORT) return 'dock'
  if (surface === SURFACE_ARTIFACTS) {
    // Below 1024 px the Artifacts tab shows the "open on the computer" notice instead, so this value
    // is never drawn there; a drawer is the harmless answer.
    return 'drawer'
  }
  return viewportWidth >= CHAT_DRAWER_MIN_VIEWPORT ? 'drawer' : 'fullscreen'
}

/**
 * Space accounting for the chat grid (list | conversation | dock).
 * The drawn width never rewrites the saved preference: it is only what fits now.
 *
 * @param {{ contentWidth: number, listWidth: number, gap: number, dockWidth: number | null,
 *   minConversation?: number, dragging?: boolean, previousMode?: 'dock' | 'drawer' | null }} input
 *   While `dragging`, the mode of `previousMode` is kept: a dock that turned into a drawer would
 *   unmount the handle under the pointer and lose the `pointerup` that saves the width.
 * @returns {{ mode: 'dock' | 'drawer', collapseList: boolean, width: number | null }}
 */
export function resolveChatDock({
  contentWidth,
  listWidth,
  gap,
  dockWidth,
  minConversation = CONVERSATION_MIN_WIDTH,
  dragging = false,
  previousMode = null,
}) {
  const wanted = Number.isFinite(dockWidth) && dockWidth > 0 ? dockWidth : DEFAULT_DOCK_WIDTH
  const conversationWithList = contentWidth - (listWidth + gap) - (wanted + gap)
  if (conversationWithList >= minConversation) {
    return { mode: 'dock', collapseList: false, width: wanted }
  }

  // The list gives way first; then the dock is drawn only as wide as leaves the conversation its minimum.
  const room = contentWidth - gap - minConversation
  let mode = room >= DOCK_MIN_WIDTH ? 'dock' : 'drawer'
  if (dragging && previousMode) mode = previousMode
  if (mode === 'drawer') return { mode, collapseList: false, width: null }
  return { mode, collapseList: true, width: Math.max(DOCK_MIN_WIDTH, Math.min(wanted, room)) }
}
