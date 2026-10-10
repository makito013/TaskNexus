import React from 'react'
import ReactDOM from 'react-dom/client'
import AppV3 from './AppV3.jsx'
import { api } from '../../services/api.js'

// Same key the theme hook will own in a later phase; read-only here.
const THEME_STORAGE_KEY = 'tasknexus.v3.theme'
const THEMES = ['light', 'dark']

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return THEMES.includes(stored) ? stored : null
  } catch {
    // localStorage can throw (private window, blocked site data): treat as unset.
    return null
  }
}

// Resolves the theme (localStorage > GET appearance > 'light'), sets
// data-layout/data-theme, renders <AppV3/>. Never mounts TerminalProvider and
// never registers the service worker (ADR-04). Never writes the appearance.
export async function bootV3() {
  let theme = readStoredTheme()
  if (!theme) {
    try {
      const appearance = await api.fetchAppearance()
      theme = THEMES.includes(appearance?.theme_mode) ? appearance.theme_mode : null
    } catch {
      theme = null
    }
  }

  document.documentElement.dataset.layout = 'v3'
  document.documentElement.dataset.theme = theme || 'light'

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppV3 />
    </React.StrictMode>
  )
}
