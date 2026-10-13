#!/usr/bin/env bash
# Installa sul server il timer systemd che esegue il backup notturno del database.
# Da lanciare una sola volta dal Mac:
#
#   ./scripts/install-backup-timer.sh
#
# Richiede la password sudo del server (chiesta a schermo, oppure in SUDO_PASS).
set -euo pipefail

# Impostazioni del tuo server, se ci sono: file locale, mai nel repo.
# Vedi scripts/deploy.config.example.
CONFIG="$(dirname "$0")/deploy.config"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"


HOST="${DEPLOY_HOST:?Server non configurato: scrivi DEPLOY_HOST in scripts/deploy.config}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/gestione-corsi}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
ON_CALENDAR="${ON_CALENDAR:-*-*-* 02:30:00}"
REMOTE_USER="${HOST%@*}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

if [[ -z "${SUDO_PASS:-}" ]]; then
  read -rsp "Password sudo per $HOST: " SUDO_PASS
  echo
fi

"${SSH[@]}" "test -x '$REMOTE_DIR/current/scripts/backup-cron.sh'" \
  || { echo "Sul server manca current/scripts/backup-cron.sh: esegui prima ./scripts/deploy.sh" >&2; exit 1; }

UNITS=$(cat <<UNIT
[Unit]
Description=Backup del database di Gestione Corsi
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$REMOTE_USER
Environment=APP_DIR=$REMOTE_DIR
ExecStart=$REMOTE_DIR/current/scripts/backup-cron.sh
UNIT
)

TIMER=$(cat <<UNIT
[Unit]
Description=Backup notturno di Gestione Corsi

[Timer]
OnCalendar=$ON_CALENDAR
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT
)

# Ogni sudo remoto riceve la password sulla propria stdin: in una catena "&&"
# solo il primo la leggerebbe.
remote_sudo() { "${SSH[@]}" "sudo -S -p '' $1" <<< "$SUDO_PASS"; }
remote_sudo_write() { "${SSH[@]}" "sudo -S -p '' tee $1 >/dev/null" <<< "$SUDO_PASS
$2"; }

remote_sudo_write /etc/systemd/system/gestione-corsi-backup.service "$UNITS"
remote_sudo_write /etc/systemd/system/gestione-corsi-backup.timer "$TIMER"
remote_sudo "systemctl daemon-reload"
remote_sudo "systemctl enable --now gestione-corsi-backup.timer"

echo
echo "Prova immediata del backup:"
remote_sudo "systemctl start gestione-corsi-backup.service"
"${SSH[@]}" "systemctl list-timers gestione-corsi-backup.timer --no-pager --no-legend; ls -1t $REMOTE_DIR/data/backups | head -3"
echo
echo "✔ Timer installato. Backup ogni giorno alle ${ON_CALENDAR##* } (ora del server), 14 giorni di storico."
echo "  Log:      ssh $HOST journalctl -u gestione-corsi-backup.service -n 20"
echo "  Copia sul Mac: ./scripts/fetch-backup.sh"
