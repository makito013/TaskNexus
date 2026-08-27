#!/usr/bin/env bash
# deploy.sh — build do frontend + instala deps do backend + sobe o backend.
#
# Uso: ./deploy.sh                  # HTTP na porta 8000 por padrão
#      ./deploy.sh --port 8000      # porta explícita
#      ./deploy.sh --no-tls         # serve HTTP sem SSL
#      ./deploy.sh --hook-port 8765 # porta do canal de hooks
#
# Suporta macOS, Linux e WSL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

NO_TLS=true
APP_PORT=8000
HOOK_PORT=8765

usage() {
  echo "Uso: $0 [opções]"
  echo "Opções:"
  echo "  -p, --port PORT       Porta do servidor backend (default: 8000)"
  echo "  -n, --no-tls          Desliga TLS e serve HTTP puro (default em Linux/WSL)"
  echo "  -hk, --hook-port PORT Porta do canal de hooks (default: 8765, 0 para desligar)"
  echo "  -h, --help            Exibe esta ajuda"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      APP_PORT="$2"
      shift 2
      ;;
    -n|--no-tls)
      NO_TLS=true
      shift
      ;;
    -hk|--hook-port)
      HOOK_PORT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      usage
      ;;
  esac
done

echo "==> Buildando frontend (npm run build)..."
(cd "$FRONTEND_DIR" && npm run build)

# Configura LOG_DIR conforme a plataforma
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
  LOG_DIR="${LOG_DIR:-$HOME/Library/Logs/escritorio-agentes}"
else
  LOG_DIR="${LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/escritorio-agentes}"
fi
mkdir -p "$LOG_DIR"

# Encontra ou cria a virtual environment do Python
VENV_PYTHON=""
for candidate in "$HOME/.venv-tasknexus/bin/python3" "$BACKEND_DIR/.venv-wsl/bin/python3" "$BACKEND_DIR/.venv/bin/python3"; do
  if [[ -x "$candidate" ]]; then
    VENV_PYTHON="$candidate"
    break
  fi
done

if [[ -z "$VENV_PYTHON" ]]; then
  echo "==> Criando ambiente virtual Python (.venv-wsl)..."
  python3 -m venv "$BACKEND_DIR/.venv-wsl"
  VENV_PYTHON="$BACKEND_DIR/.venv-wsl/bin/python3"
fi

echo "==> Atualizando dependências do backend (pip install -r requirements.txt)..."
"$VENV_PYTHON" -m pip install -q -r "$BACKEND_DIR/requirements.txt"

if [[ "$HOOK_PORT" -gt 0 ]]; then
  if [[ "$HOOK_PORT" -eq "$APP_PORT" ]]; then
    HOOK_PORT=$((APP_PORT + 1))
    echo "==> AVISO: Porta de hooks ajustada para $HOOK_PORT para não colidir com o app"
  fi
  export HOOK_LOOPBACK_PORT="$HOOK_PORT"
  echo "==> Canal de hooks ativo na porta $HOOK_LOOPBACK_PORT"
else
  unset HOOK_LOOPBACK_PORT || true
fi

SCHEME="http"
echo "==> Subindo backend em ${SCHEME}://0.0.0.0:${APP_PORT} (Ctrl+C para parar) — logs em $LOG_DIR/uvicorn.log"

exec > >(tee -a "$LOG_DIR/uvicorn.log") 2>&1

cd "$BACKEND_DIR"
exec "$VENV_PYTHON" -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$APP_PORT" \
  --log-level warning \
  --timeout-graceful-shutdown 5
