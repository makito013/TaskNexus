import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Node 25+ ships Web Storage on by default (opt-out via --no-experimental-webstorage);
    // Vitest's jsdom key-copy allowlist (getWindowKeys) does not include localStorage/
    // sessionStorage, so it refuses to overwrite Node's already-present-but-broken global
    // with jsdom's working one. Fixed upstream only in Vitest 5 (beta, breaking) — see
    // vitest-dev/vitest#10867 and rejected 4.x backport #10873. Safe to remove once this
    // repo is on Vitest 5+. Guarded by major version because Node <25 has Web Storage off
    // by default and therefore does not need the flag; whether older versions would also
    // reject it as unknown was not verified (no Node <25 available here), so the guard
    // keeps the flag off where it has no purpose either way.
    execArgv:
      Number(process.versions.node.split('.')[0]) >= 25
        ? ['--no-experimental-webstorage']
        : [],
  },
})
