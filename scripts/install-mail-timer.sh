#!/usr/bin/env bash
# Installa sul server il timer systemd che controlla la posta a intervalli regolari.
# Da lanciare una sola volta dal Mac:
#
#   ./scripts/install-mail-timer.sh
#
# Il controllo legge le mail dei mittenti seguiti e prepara le proposte:
# non modifica mai corsi o calendario da solo.
# Richiede la password sudo del server (chiesta a schermo, oppure in SUDO_PASS).
set -euo pipefail

# Impostazioni del tuo server, se ci sono: file locale, mai nel repo.
# Vedi scripts/deploy.config.example.
CONFIG="$(dirname "$0")/deploy.config"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"


HOST="${DEPLOY_HOST:?Server non configurato: scrivi DEPLOY_HOST in scripts/deploy.config}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
APP_URL="${APP_URL:-http://127.0.0.1:8081}"
EVERY="${EVERY:-10min}"
REMOTE_USER="${HOST%@*}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

if [[ -z "${SUDO_PASS:-}" ]]; then
  read -rsp "Password sudo per $HOST: " SUDO_PASS
  echo
fi

SERVICE=$(cat <<UNIT
[Unit]
Description=Controllo della posta di Gestione Corsi
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$REMOTE_USER
ExecStart=/usr/bin/curl -fsS -m 120 -X POST $APP_URL/api/posta
UNIT
)

TIMER=$(cat <<UNIT
[Unit]
Description=Controllo periodico della posta di Gestione Corsi

[Timer]
OnBootSec=3min
OnUnitActiveSec=$EVERY
Persistent=true

[Install]
WantedBy=timers.target
UNIT
)

remote_sudo() { "${SSH[@]}" "sudo -S -p '' $1" <<< "$SUDO_PASS"; }
remote_sudo_write() { "${SSH[@]}" "sudo -S -p '' tee $1 >/dev/null" <<< "$SUDO_PASS
$2"; }

remote_sudo_write /etc/systemd/system/gestione-corsi-posta.service "$SERVICE"
remote_sudo_write /etc/systemd/system/gestione-corsi-posta.timer "$TIMER"
remote_sudo "systemctl daemon-reload"
remote_sudo "systemctl enable --now gestione-corsi-posta.timer"

echo
echo "Prova immediata:"
remote_sudo "systemctl start gestione-corsi-posta.service"
"${SSH[@]}" "systemctl list-timers gestione-corsi-posta.timer --no-pager --no-legend"
echo
echo "✔ Timer installato: controllo ogni $EVERY."
echo "  Log: ssh $HOST journalctl -u gestione-corsi-posta.service -n 20"
