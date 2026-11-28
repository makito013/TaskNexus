import { useEffect, useState } from 'react'

// The theme the shell wrote on <html data-theme>, followed live: the syntax colours are recomputed when it changes.
export function useThemeName() {
  const [theme, setTheme] = useState(() => (typeof document === 'undefined' ? 'light' : document.documentElement.dataset.theme || 'light'))
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(root.dataset.theme || 'light'))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    setTheme(root.dataset.theme || 'light')
    return () => observer.disconnect()
  }, [])
  return theme
}
