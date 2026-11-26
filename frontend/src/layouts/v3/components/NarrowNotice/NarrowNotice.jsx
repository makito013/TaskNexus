import { useEffect, useState } from 'react'
import { useMediaQuery } from '../../../../hooks/useMediaQuery.js'
import { useTopModal } from '../Dialog/modalStack.js'
import Panel from '../Panel/Panel.jsx'

// Board and Artefatos need at least 1024 px (an iPad on its side). Below that
// the tab says so. The query is false in jsdom (no matchMedia), so the screens
// really mount in the tests.
export const NARROW_WINDOW_QUERY = '(max-width: 1023px)'

// Whether the window counts as narrow right now. Crossing the limit while a
// modal dialog is open does not swap the screen under it: the answer waits until
// the modal closes, so a form being filled is never thrown away.
export function useNarrowWindow() {
  const narrow = useMediaQuery(NARROW_WINDOW_QUERY)
  const modalOpen = useTopModal() !== null
  const [shown, setShown] = useState(narrow)
  useEffect(() => {
    if (!modalOpen) setShown(narrow)
  }, [narrow, modalOpen])
  return shown
}

// No button and no link to the V2: this build does not contain it.
export default function NarrowNotice() {
  return (
    <Panel notice="fin">
      <h2 className="v3-type-body v3-narrow-notice__title">Abra no computador</h2>
      <span className="v3-type-body-sm">
        O Board e os Artefatos precisam de uma janela de pelo menos 1024 px de largura. Abra o TaskNexus no
        computador ou deite o iPad.
      </span>
    </Panel>
  )
}
