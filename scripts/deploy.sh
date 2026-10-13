#!/usr/bin/env bash
# Deploy atomico di Gestione Corsi su un server Docker remoto.
#
#   ./scripts/deploy.sh [--host utente@ip] [--port 8081] [--dir /percorso] [opzioni]
#
# Come funziona:
#   1. verifica in locale: typecheck, lint, test, build e test di fumo nel browser
#      (si ferma al primo errore);
#   2. copia il codice in una nuova release sul server: releases/<timestamp>;
#   3. costruisce l'immagine Docker con un tag dedicato alla release;
#   4. fa il backup del database PRIMA di cambiare versione;
#   5. avvia la nuova versione e ne verifica la salute;
#   6. se qualcosa non risponde, torna automaticamente alla release precedente.
#
# Database (`data/`) e credenziali (`.env`) vivono fuori dalle release: non vengono
# mai sovrascritti da un deploy.
set -euo pipefail

# Impostazioni del tuo server, se ci sono: file locale, mai nel repo.
# Vedi scripts/deploy.config.example.
CONFIG="$(dirname "$0")/deploy.config"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"

HOST="${DEPLOY_HOST:-}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/gestione-corsi}"
APP_PORT="${DEPLOY_PORT:-3000}"
APP_BIND="${DEPLOY_BIND:-0.0.0.0}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
KEEP_RELEASES=5
SKIP_CHECKS=0
PUSH_ENV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --dir) REMOTE_DIR="$2"; shift 2 ;;
    --port) APP_PORT="$2"; shift 2 ;;
    --bind) APP_BIND="$2"; shift 2 ;;
    --key) SSH_KEY="$2"; shift 2 ;;
    --keep) KEEP_RELEASES="$2"; shift 2 ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;      # solo per riprovare un deploy già verificato
    --push-env) PUSH_ENV=1; shift ;;            # sovrascrive il .env remoto con quello locale
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Opzione sconosciuta: $1" >&2; exit 2 ;;
  esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

RELEASE="$(date +%Y%m%d-%H%M%S)"
IMAGE_TAG="$RELEASE"
if [[ -z "$HOST" ]]; then
  echo "Server non configurato: usa --host utente@indirizzo, oppure scrivi DEPLOY_HOST in scripts/deploy.config (vedi deploy.config.example)." >&2
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
step "1/7 Verifica locale (build stabile)"
if [[ "$SKIP_CHECKS" -eq 1 ]]; then
  echo "salta i controlli (--skip-checks)"
else
  npm run typecheck
  npm run lint
  npm run test
  npm run build
  npm run smoke   # avvia davvero l'app e ne ripercorre il percorso critico nel browser
  echo "✔ typecheck, lint, test, build e test di fumo superati"
fi

# ---------------------------------------------------------------------------
step "2/7 Connessione a $HOST"
"${SSH[@]}" 'docker version --format "{{.Server.Version}}" >/dev/null' \
  || fail "Server non raggiungibile o Docker non utilizzabile da questo utente."
"${SSH[@]}" "mkdir -p '$REMOTE_DIR/releases' '$REMOTE_DIR/data' '$REMOTE_DIR/backups'"
echo "✔ $HOST pronto ($REMOTE_DIR)"

# .env: creato al primo deploy, poi mai toccato (a meno di --push-env).
if [[ "$PUSH_ENV" -eq 1 ]] || ! "${SSH[@]}" "test -f '$REMOTE_DIR/.env'"; then
  [[ -f .env ]] || fail "Manca il file .env locale da copiare sul server."
  scp -i "$SSH_KEY" -q .env "$HOST:$REMOTE_DIR/.env"
  "${SSH[@]}" "chmod 600 '$REMOTE_DIR/.env'"
  echo "✔ .env copiato sul server (contiene le chiavi API)"
fi

# ---------------------------------------------------------------------------
step "3/7 Copia del codice nella release $RELEASE"
rsync -az --delete -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  --exclude ".git" --exclude "node_modules" --exclude ".next" \
  --exclude "data" --exclude "backups" --exclude ".env" \
  --exclude "*.db" --exclude "*.db-wal" --exclude "*.db-shm" \
  --exclude "Lezioni*" --exclude "*.tsbuildinfo" \
  ./ "$HOST:$REMOTE_DIR/releases/$RELEASE/"
# Database e credenziali sono condivisi da tutte le release.
"${SSH[@]}" "ln -sfn '$REMOTE_DIR/.env' '$REMOTE_DIR/releases/$RELEASE/.env'"
echo "✔ codice sincronizzato"

# ---------------------------------------------------------------------------
step "4/7 Build dell'immagine Docker (gestione-corsi:$IMAGE_TAG)"
"${SSH[@]}" "cd '$REMOTE_DIR/releases/$RELEASE' && IMAGE_TAG='$IMAGE_TAG' docker compose --project-name gestione-corsi build" \
  || fail "Build dell'immagine fallita: la versione in esecuzione non è stata toccata."
echo "✔ immagine pronta"

# ---------------------------------------------------------------------------
step "5/7 Backup del database"
PREVIOUS="$("${SSH[@]}" "readlink '$REMOTE_DIR/current' 2>/dev/null | xargs -r basename" || true)"
if "${SSH[@]}" "test -f '$REMOTE_DIR/data/app.db'"; then
  "${SSH[@]}" "cd '$REMOTE_DIR/releases/$RELEASE' && \
    docker run --rm -v '$REMOTE_DIR/data':/data -e DATABASE_URL=file:/data/app.db \
      -e BACKUP_DIR=/data/backups 'gestione-corsi:$IMAGE_TAG' node scripts/backup.mjs" \
    || fail "Backup del database fallito: deploy interrotto."
else
  echo "nessun database esistente (primo deploy)"
fi

# ---------------------------------------------------------------------------
step "6/7 Avvio della nuova versione"
"${SSH[@]}" "ln -sfn '$REMOTE_DIR/releases/$RELEASE' '$REMOTE_DIR/current'"
"${SSH[@]}" "cd '$REMOTE_DIR/current' && \
  IMAGE_TAG='$IMAGE_TAG' APP_PORT='$APP_PORT' APP_BIND='$APP_BIND' DATA_DIR='$REMOTE_DIR/data' \
  docker compose --project-name gestione-corsi up -d --remove-orphans"

step "7/7 Verifica di salute"
HEALTHY=0
for i in $(seq 1 30); do
  if "${SSH[@]}" "curl -fsS --max-time 3 http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 2
done

if [[ "$HEALTHY" -eq 0 ]]; then
  printf '\033[31m✖ La nuova versione non risponde.\033[0m\n' >&2
  "${SSH[@]}" "cd '$REMOTE_DIR/current' && docker compose --project-name gestione-corsi logs --tail 40 app" >&2 || true
  if [[ -n "$PREVIOUS" ]]; then
    echo "↩ rollback alla release $PREVIOUS" >&2
    "${SSH[@]}" "ln -sfn '$REMOTE_DIR/releases/$PREVIOUS' '$REMOTE_DIR/current' && cd '$REMOTE_DIR/current' && \
      IMAGE_TAG='$PREVIOUS' APP_PORT='$APP_PORT' APP_BIND='$APP_BIND' DATA_DIR='$REMOTE_DIR/data' \
      docker compose --project-name gestione-corsi up -d" >&2
    fail "Deploy annullato: è tornata attiva la versione $PREVIOUS (database intatto)."
  fi
  fail "Deploy fallito al primo avvio: controlla i log qui sopra."
fi

# Pulizia delle release vecchie (il database non è qui dentro).
"${SSH[@]}" "cd '$REMOTE_DIR/releases' && ls -1t | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf"
"${SSH[@]}" "docker image prune -f >/dev/null 2>&1" || true

IP="${HOST#*@}"
printf '\n\033[32m✔ Deploy completato: release %s attiva su http://%s:%s\033[0m\n' "$RELEASE" "$IP" "$APP_PORT"
[[ -n "$PREVIOUS" ]] && echo "  versione precedente: $PREVIOUS (rollback: ./scripts/rollback.sh $PREVIOUS)"
exit 0
