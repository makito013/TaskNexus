import { useEffect } from 'react'
import Panel from '../../components/Panel/Panel.jsx'

// PLACEHOLDER of the Tarefas screen. The real screen (validation tasks and board
// cards) replaces this file in the next phase. Focus on the heading is moved by
// the shell (AppV3) when the module changes.
export default function TasksScreen() {
  useEffect(() => {
    document.title = 'Tarefas · TaskNexus'
  }, [])

  return (
    <div className="v3-screen">
      <h1 tabIndex={-1} className="v3-type-title-lg v3-screen__title">Tarefas</h1>
      <Panel>A lista de tarefas chega na próxima etapa.</Panel>
    </div>
  )
}
