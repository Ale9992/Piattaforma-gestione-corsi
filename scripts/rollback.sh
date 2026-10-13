#!/usr/bin/env bash
# Torna a una release precedente già presente sul server.
#   ./scripts/rollback.sh              elenca le release disponibili
#   ./scripts/rollback.sh 20260915-193000
set -euo pipefail

# Impostazioni del tuo server, se ci sono: file locale, mai nel repo.
# Vedi scripts/deploy.config.example.
CONFIG="$(dirname "$0")/deploy.config"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"


HOST="${DEPLOY_HOST:?Server non configurato: scrivi DEPLOY_HOST in scripts/deploy.config}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/gestione-corsi}"
APP_PORT="${APP_PORT:-8081}"
APP_BIND="${APP_BIND:-0.0.0.0}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

if [[ $# -eq 0 ]]; then
  echo "Release disponibili (la più recente per prima):"
  "${SSH[@]}" "ls -1t '$REMOTE_DIR/releases'"
  echo
  echo "Attiva ora: $("${SSH[@]}" "readlink '$REMOTE_DIR/current' | xargs -r basename")"
  exit 0
fi

RELEASE="$1"
"${SSH[@]}" "test -d '$REMOTE_DIR/releases/$RELEASE'" || { echo "Release $RELEASE inesistente." >&2; exit 1; }

"${SSH[@]}" "ln -sfn '$REMOTE_DIR/releases/$RELEASE' '$REMOTE_DIR/current' && cd '$REMOTE_DIR/current' && \
  IMAGE_TAG='$RELEASE' APP_PORT='$APP_PORT' APP_BIND='$APP_BIND' DATA_DIR='$REMOTE_DIR/data' \
  docker compose --project-name gestione-corsi up -d"

for i in $(seq 1 30); do
  if "${SSH[@]}" "curl -fsS --max-time 3 http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    echo "✔ Rollback completato: release $RELEASE attiva."
    exit 0
  fi
  sleep 2
done
echo "✖ La release $RELEASE non risponde: controlla i log con docker compose logs." >&2
exit 1
