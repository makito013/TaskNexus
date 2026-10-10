import './index.css'
import { bootV2 } from './boot/bootV2.jsx'
import { runBoot } from './boot/runBoot.js'

// The mode comparison below MUST stay a literal `import.meta.env.MODE === 'v3'`
// in this file: Vite replaces it with a constant at build time, which lets
// Rollup drop the dynamic import (and the whole v3 chunk) from the default
// build. Routing the comparison through a function would keep the chunk in the
// production dist. Guarded by main.source.test.js.
const loadV3 = import.meta.env.MODE === 'v3' ? () => import('./layouts/v3/bootV3.jsx') : null

runBoot({ loadV3, bootV2 })
