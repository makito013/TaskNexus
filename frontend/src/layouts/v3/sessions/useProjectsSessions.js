import { createContext, useContext } from 'react'

// Context of the sessions provider. The default value is INERT: empty lists, no-op actions and
// no network, so a screen rendered without the provider (tests, isolated use) behaves as if
// there were no chats.
// What the chats add to the Projects screen, in the shape of the V2 endpoints (active: status,
// connected, needs_attention, display_name; persisted: display_name, needs_attention, push_notified),
// only for chat keys. ONE shared constant: with no chat the Provider and the inert value hand out
// this very object, so the screen can tell "nothing to merge" by reference.
export const EMPTY_PROJECTS_LIVE = Object.freeze({ active: Object.freeze({}), persisted: Object.freeze({}) })

export const INERT_SESSIONS = Object.freeze({
  chats: Object.freeze([]),
  liveByKey: Object.freeze({}),
  projectsLive: EMPTY_PROJECTS_LIVE,
  ptyPersisted: Object.freeze({}),
  health: null,
  liveAvailable: false,
  loaded: false,
  graceKeys: Object.freeze([]),
  focusedKey: null,
  setFocusedKey: () => {},
  openChat: () => {},
  goTo: () => {},
  registerCreated: () => {},
  refresh: () => {},
  clearAttention: () => {},
})

export const ProjectsSessionsContext = createContext(INERT_SESSIONS)

export function useProjectsSessions() {
  return useContext(ProjectsSessionsContext)
}
