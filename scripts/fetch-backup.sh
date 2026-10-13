#!/usr/bin/env bash
# Porta sul Mac l'ultimo backup del database in produzione e ne verifica l'integrità.
# È la copia "fuori dal server": se il server si guasta, i dati restano qui.
#
#   ./scripts/fetch-backup.sh            scarica in ./backups/
#   ./scripts/fetch-backup.sh /percorso  scarica altrove
set -euo pipefail

# Impostazioni del tuo server, se ci sono: file locale, mai nel repo.
# Vedi scripts/deploy.config.example.
CONFIG="$(dirname "$0")/deploy.config"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"


HOST="${DEPLOY_HOST:?Server non configurato: scrivi DEPLOY_HOST in scripts/deploy.config}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/gestione-corsi}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
DEST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

mkdir -p "$DEST"
LATEST="$("${SSH[@]}" "ls -1t '$REMOTE_DIR/data/backups'/app-*.db 2>/dev/null | head -1")"
[[ -n "$LATEST" ]] || { echo "Nessun backup sul server: esegui ./scripts/install-backup-timer.sh" >&2; exit 1; }

scp -i "$SSH_KEY" -q "$HOST:$LATEST" "$DEST/"
FILE="$DEST/$(basename "$LATEST")"

if command -v sqlite3 >/dev/null; then
  [[ "$(sqlite3 "$FILE" 'pragma integrity_check')" == "ok" ]] || { echo "✖ Backup corrotto: $FILE" >&2; exit 1; }
  CORSI=$(sqlite3 "$FILE" 'select count(*) from courses')
  LEZIONI=$(sqlite3 "$FILE" 'select count(*) from lessons')
  echo "✔ $FILE — integrità ok, $CORSI corsi e $LEZIONI lezioni"
else
  echo "✔ $FILE scaricato (sqlite3 non installato: verifica saltata)"
fi
