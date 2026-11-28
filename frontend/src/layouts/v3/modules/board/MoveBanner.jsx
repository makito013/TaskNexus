import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'

const TEXT = {
  card: 'Não consegui mover o card. Ele voltou para onde estava.',
  board_changed: 'O board mudou. Atualizei as colunas e o card voltou para onde estava.',
  column: 'Não consegui mover a coluna. Ela voltou para onde estava.',
  done: 'Não consegui marcar a coluna como concluída.',
}

// The notice above the columns when a move was refused. An alert (announced without taking the
// focus: the person may be in the middle of another gesture), it stays until it is closed or the
// next move works. No alert(): it never blocks the tab.
//   notice     null | { kind: 'card' | 'board_changed' | 'column' | 'done' }
export default function MoveBanner({ notice, onDismiss }) {
  if (!notice || !TEXT[notice.kind]) return null
  return (
    <Panel notice="fin" role="alert" className="v3-board-banner">
      {TEXT[notice.kind]}{' '}
      <Button variant="text" onClick={onDismiss}>Fechar</Button>
    </Panel>
  )
}
