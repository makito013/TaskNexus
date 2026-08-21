import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { api } from './services/api.js'
import { registerServiceWorker } from './hooks/useServiceWorker.js'

// Milestone 1 (plano Layout v2, 05-TL.md): bootstrap assíncrono — busca a
// configuração de aparência ANTES de montar <App/>, para que
// layout_version/theme_mode já estejam resolvidos no primeiro render (sem
// alternar de layout depois de montado). `.catch()` é obrigatório: o boot
// nunca pode travar esperando o backend — se o fetch falhar (backend fora do
// ar), cai pro default v1/dark, o comportamento já validado em produção.
const DEFAULT_APPEARANCE = { layout_version: 'v2', theme_mode: 'light' }

api.fetchAppearance()
  .catch(() => DEFAULT_APPEARANCE)
  .then((appearance) => {
    // Setado ANTES do render — index.css/temas futuros podem ler esses
    // atributos síncronamente no primeiro paint do React.
    document.documentElement.dataset.layout = 'v2'
    document.documentElement.dataset.theme = appearance.theme_mode || 'light'

    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App initialAppearance={appearance} />
      </React.StrictMode>
    )

    // Fire-and-forget, same as the appearance fetch above: registration
    // never rejects (see useServiceWorker.js), so no .catch() is needed
    // here, and it must not block/delay the render call above it.
    registerServiceWorker()
  })
