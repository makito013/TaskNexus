#!/usr/bin/env bash
# deploy.sh — build do frontend + instala deps do backend + sobe o backend.
#
# Uso: ./deploy.sh                  # HTTP na porta 8000 por padrão
#      ./deploy.sh --port 8000      # porta explícita
#      ./deploy.sh --no-tls         # serve HTTP sem SSL
#      ./deploy.sh --hook-port 8765 # porta do canal de hooks
#      SESSIONS_DB=/tmp/tn-v3/sessions-v3.db ./deploy.sh --v3 --port 8010 --hook-port 8766
#                                   # layout V3 experimental (cópia do banco obrigatória)
#
# Suporta macOS, Linux e WSL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

NO_TLS=true
APP_PORT=8000
PORT_SET=false
HOOK_PORT=8765
V3=false

usage() {
  echo "Uso: $0 [opções]"
  echo "Opções:"
  echo "  -p, --port PORT       Porta do servidor backend (default: 8000)"
  echo "  -n, --no-tls          Desliga TLS e serve HTTP puro (default em Linux/WSL)"
  echo "  -hk, --hook-port PORT Porta do canal de hooks (default: 8765, 0 para desligar)"
  echo "      --v3              Layout V3 experimental (serve frontend/dist-v3; exige SESSIONS_DB com uma cópia do banco)"
  echo "  -h, --help            Exibe esta ajuda"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      APP_PORT="$2"
      PORT_SET=true
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
    --v3)
      V3=true
      shift
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

if [[ "$V3" == true ]]; then
  BUILD_SCRIPT="build:v3"
  if [[ "$PORT_SET" == false ]]; then
    echo "==> AVISO: --v3 sem --port usa a 8000; se a produção estiver nela, use --port 8010 --hook-port 8766"
  fi
  # --v3 never opens the real sessions.db: two backends on the same SQLite file
  # fight over writes and run the same background jobs. The backend resolves
  # SESSIONS_DB relative to backend/.
  real_db="$(cd "$BACKEND_DIR" && pwd -P)/sessions.db"
  v3_db=""
  if [[ -n "${SESSIONS_DB:-}" ]]; then
    case "$SESSIONS_DB" in
      /*) v3_db="$SESSIONS_DB" ;;
      *) v3_db="$BACKEND_DIR/$SESSIONS_DB" ;;
    esac
    if [[ -d "$(dirname "$v3_db")" ]]; then
      v3_db="$(cd "$(dirname "$v3_db")" && pwd -P)/$(basename "$v3_db")"
    fi
  fi
  # -ef also catches symlinks and case-insensitive filesystems (APFS, DrvFs).
  if [[ -z "$v3_db" || "$v3_db" == "$real_db" || ( -e "$v3_db" && "$v3_db" -ef "$real_db" ) ]]; then
    echo "ERRO: --v3 exige SESSIONS_DB apontando para uma CÓPIA do banco, não o backend/sessions.db da produção." >&2
    echo "Exemplo (cópia consistente mesmo com a produção no ar):" >&2
    echo "  mkdir -p /tmp/tn-v3" >&2
    echo "  python3 -c \"import sqlite3; s=sqlite3.connect('backend/sessions.db'); d=sqlite3.connect('/tmp/tn-v3/sessions-v3.db'); s.backup(d)\"" >&2
    echo "  SESSIONS_DB=/tmp/tn-v3/sessions-v3.db ./deploy.sh --v3 --port 8010 --hook-port 8766" >&2
    exit 1
  fi
  [[ -f "$v3_db" ]] || echo "==> AVISO: SESSIONS_DB=$v3_db não existe: o backend vai criar um banco vazio"
  echo "==> V3 usando o banco $v3_db"
else
  BUILD_SCRIPT="build"
fi

echo "==> Buildando frontend (npm run $BUILD_SCRIPT)..."
(cd "$FRONTEND_DIR" && npm run "$BUILD_SCRIPT")

# Both branches are explicit: an exported FRONTEND_DIST inherited from the
# caller's shell must not leak into a deploy without the flag.
if [[ "$V3" == true ]]; then
  export FRONTEND_DIST="$FRONTEND_DIR/dist-v3"
  LOG_FILE="uvicorn-v3.log"
  echo "==> Layout V3 (experimental) ativo — servindo frontend/dist-v3 (terminal, board e chat indisponíveis nesta versão)"
else
  unset FRONTEND_DIST || true
  if [[ -n "${SESSIONS_DB:-}" ]]; then
    echo "==> AVISO: SESSIONS_DB=$SESSIONS_DB está setado: este deploy vai usar esse banco, não o backend/sessions.db"
  fi
  LOG_FILE="uvicorn.log"
fi

# Configura LOG_DIR conforme a plataforma
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
  LOG_DIR="${LOG_DIR:-$HOME/Library/Logs/escritorio-agentes}"
else
  LOG_DIR="${LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/escritorio-agentes}"
fi
mkdir -p "$LOG_DIR"

# Encontra ou cria a virtual environment do Python
VENV_PYTHON=""
VENV_CREATED=false
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
  VENV_CREATED=true
fi

# The venv is shared with production: pip under a live process can swap a lib
# from under it. V3 adds no backend dependency, so --v3 skips pip unless the
# venv was just created.
if [[ "$V3" == true && "$VENV_CREATED" == false ]]; then
  echo "==> V3: pulando pip install (o venv é compartilhado com a produção)"
else
  echo "==> Atualizando dependências do backend (pip install -r requirements.txt)..."
  "$VENV_PYTHON" -m pip install -q -r "$BACKEND_DIR/requirements.txt"
fi

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
echo "==> Subindo backend em ${SCHEME}://0.0.0.0:${APP_PORT} (Ctrl+C para parar) — logs em $LOG_DIR/$LOG_FILE"

exec > >(tee -a "$LOG_DIR/$LOG_FILE") 2>&1

cd "$BACKEND_DIR"
exec "$VENV_PYTHON" -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$APP_PORT" \
  --log-level warning \
  --timeout-graceful-shutdown 5
