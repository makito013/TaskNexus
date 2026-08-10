#!/usr/bin/env bash
# deploy.sh — build do frontend + sobe o backend servindo tudo numa porta só.
#
# Uso: ./deploy.sh
#
# Log: em modo prod o uvicorn roda com --log-level warning (sem spam de
# "connection open/closed" por WS) e a saída (stdout+stderr) vai simultaneamente
# pro terminal e para um arquivo persistente em $LOG_DIR (default:
# ~/Library/Logs/escritorio-agentes/uvicorn.log) via tee.
#
# Não faz supervisão de processo (auto-restart) — pendência conhecida. Rode
# isso num terminal que você vai deixar aberto (ou dentro do seu próprio
# wrapper de supervisão, ex: launchd), e pare com Ctrl+C — o shutdown
# gracioso do uvicorn (--timeout-graceful-shutdown) garante que o processo
# sai em poucos segundos mesmo com conexões WS/PTY abertas.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "==> Buildando frontend (npm run build)..."
(cd "$FRONTEND_DIR" && npm run build)

LOG_DIR="${LOG_DIR:-$HOME/Library/Logs/escritorio-agentes}"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_DIR/uvicorn.log") 2>&1

# Sem HOOK_LOOPBACK_PORT de propósito: aqui o app já responde em HTTP na 8000,
# que é exatamente o fallback usado pela URL dos hooks quando não há listener de
# loopback. O canal só precisa de porta própria quando o app está em 443/TLS ou
# em porta arbitrária — ver a seção "Canal de hooks" do deploy.ps1.
echo "==> Subindo backend em http://0.0.0.0:8000 (Ctrl+C para parar) — logs em $LOG_DIR/uvicorn.log"
cd "$BACKEND_DIR"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --log-level warning \
  --timeout-graceful-shutdown 5
