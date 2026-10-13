#!/usr/bin/env bash
# Backup notturno del database in produzione. Eseguito dal timer systemd
# gestione-corsi-backup.timer (vedi scripts/install-backup-timer.sh).
#
# Usa l'API di backup online di SQLite dentro il container: è consistente anche
# con l'applicazione in esecuzione, e verifica l'integrità della copia.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gestione-corsi}"
CONTAINER="${CONTAINER:-gestione-corsi}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_DIR="$APP_DIR/data/backups"

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER non in esecuzione: backup non eseguito." >&2
  exit 1
fi

docker exec -e BACKUP_DIR=/data/backups "$CONTAINER" node scripts/backup.mjs

# Ritenzione: elimina le copie più vecchie di KEEP_DAYS giorni.
find "$BACKUP_DIR" -maxdepth 1 -name 'app-*.db' -type f -mtime "+$KEEP_DAYS" -delete

COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'app-*.db' -type f | wc -l | tr -d ' ')
LATEST=$(ls -1t "$BACKUP_DIR"/app-*.db | head -1)
echo "Backup piu' recente: $LATEST ($(du -h "$LATEST" | cut -f1)) — copie conservate: $COUNT"
