import React from 'react'
import ReactDOM from 'react-dom/client'
import AppV3 from './AppV3.jsx'
import { api } from '../../services/api.js'
import { readStoredTheme, resolveTheme } from './theme/useV3Theme.js'
import './theme/fonts.css'
import './theme/tokens.css'
import './theme/base.css'

// The appearance request must never keep the app on a blank page: past this
// limit the boot goes on with the default theme.
export const APPEARANCE_TIMEOUT_MS = 3000

function fetchAppearanceTheme() {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), APPEARANCE_TIMEOUT_MS)
  })
  const request = api.fetchAppearance().then((appearance) => appearance?.theme_mode)
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}

// Resolves the theme (localStorage > GET appearance > 'light'), sets
// data-layout/data-theme, renders <AppV3/>. Never mounts TerminalProvider and
// never registers the service worker (ADR-04). Never writes the appearance.
export async function bootV3() {
  let appearanceTheme = null
  if (!readStoredTheme()) {
    try {
      appearanceTheme = await fetchAppearanceTheme()
    } catch {
      // Backend unreachable or timed out: the boot must not block on it, fall back to light.
      appearanceTheme = null
    }
  }
  const theme = resolveTheme(appearanceTheme)

  document.documentElement.dataset.layout = 'v3'
  document.documentElement.dataset.theme = theme

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppV3 initialTheme={theme} />
    </React.StrictMode>
  )
}
