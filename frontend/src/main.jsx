import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { api } from './services/api.js'

// Milestone 1 (plano Layout v2, 05-TL.md): bootstrap assíncrono — busca a
// configuração de aparência ANTES de montar <App/>, para que
// layout_version/theme_mode já estejam resolvidos no primeiro render (sem
// alternar de layout depois de montado). `.catch()` é obrigatório: o boot
// nunca pode travar esperando o backend — se o fetch falhar (backend fora do
// ar), cai pro default v1/dark, o comportamento já validado em produção.
const DEFAULT_APPEARANCE = { layout_version: 'v1', theme_mode: 'dark' }

api.fetchAppearance()
  .catch(() => DEFAULT_APPEARANCE)
  .then((appearance) => {
    // Setado ANTES do render — index.css/temas futuros podem ler esses
    // atributos síncronamente no primeiro paint do React.
    document.documentElement.dataset.layout = appearance.layout_version
    document.documentElement.dataset.theme = appearance.theme_mode

    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App initialAppearance={appearance} />
      </React.StrictMode>
    )
  })
