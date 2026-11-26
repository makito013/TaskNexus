import { Component, Suspense } from 'react'
import Button from '../Button/Button.jsx'
import Panel from '../Panel/Panel.jsx'

const reloadPage = () => window.location.reload()

class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.warn('lazy chunk failed to load', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Panel notice="fin" role="alert">
        <b>Não carregou.</b> Esta parte da tela não abriu.{' '}
        <Button variant="secondary" size="sm" onClick={this.props.onReload}>Recarregar</Button>
      </Panel>
    )
  }
}

// Suspense plus an error boundary for a React.lazy screen. While the chunk
// loads it shows a quiet placeholder (no live region: the screens own their
// own statuses); when the chunk fails (offline, a deploy replaced the files) it
// says so with a button that reloads the page, since importing again would
// answer from the same failed request.
export default function LazyBoundary({ children, label = 'Carregando…', onReload = reloadPage }) {
  return (
    <ChunkErrorBoundary onReload={onReload}>
      <Suspense fallback={<p className="v3-type-body-sm" aria-busy="true">{label}</p>}>
        {children}
      </Suspense>
    </ChunkErrorBoundary>
  )
}
