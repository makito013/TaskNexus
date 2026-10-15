import { useCallback, useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'tasknexus.v3.theme'
export const THEMES = ['light', 'dark']
export const DEFAULT_THEME = 'light'

export function isTheme(value) {
  return THEMES.includes(value)
}

export function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // localStorage can throw (private window, blocked site data): treat as unset.
    return null
  }
}

function writeStoredTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Persisting is a convenience; the theme still applies for this session.
  }
}

// Stored choice > theme from the appearance settings > light.
export function resolveTheme(appearanceTheme) {
  return readStoredTheme() || (isTheme(appearanceTheme) ? appearanceTheme : DEFAULT_THEME)
}

// The v3 theme lives in the browser only (ADR-06): the toggle writes
// localStorage and never the appearance settings of the shared database.
export function useV3Theme({ initialTheme } = {}) {
  const [theme, setTheme] = useState(() => resolveTheme(initialTheme))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    writeStoredTheme(next)
    setTheme(next)
  }, [theme])

  return { theme, toggleTheme }
}
