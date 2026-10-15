import { useMediaQuery } from '../../../hooks/useMediaQuery.js'

// True when the user asked the OS for less motion. CSS cannot switch SMIL
// animations off, so components that render <animate*> must check this.
export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
