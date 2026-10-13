# Gestione Corsi

Gestionale a utente singolo per chi insegna su incarico: corsi, calendarizzazione, lezioni, prelezioni, pause,
festività, annullamenti, ore svolte, compensi e disponibilità da comunicare per i corsi nuovi.

Nasce per un caso concreto: un formatore che riceve gli incarichi da un'agenzia via mail — "corso di 40 ore,
martedì e giovedì 18–20, dal 6 ottobre" — e deve sapere in che data finirà, quante ore ha ancora da fare, cosa
slitta quando una lezione si annulla e quali fasce ha libere da offrire. Il nome dell'agenzia e le caselle da
leggere stanno nella configurazione: il codice non sa niente di nessuno.

> **Software deterministico per la gestione; AI solo per estrarre i dati iniziali.**
> DeepSeek viene usato esclusivamente, e in modo opzionale, per compilare il form di un nuovo corso a partire dal
> testo di una mail. Date, ore, recuperi, pause, festività e disponibilità sono calcolati dal codice TypeScript.

## Cosa fa

- **Calendarizza** un corso da una regola ("martedì e giovedì 18–20, 40 ore") e ne calcola la data di fine,
  saltando le festività italiane e le pause; le fasi si possono cambiare in corsa e i giorni aggiungere dopo.
- **Annulla e recupera**: una lezione annullata non si perde, le sue ore tornano in coda al corso.
- **Legge gli incarichi dalla posta** e li trasforma in *proposte da confermare* — mai in modifiche automatiche:
  nuovo corso, annullamento, cambio di calendario, chiusura. Dal PDF del calendario allegato ricava le regole e
  verifica che rigenerino esattamente quelle date, altrimenti lo dichiara invece di indovinare.
- **Calcola le disponibilità**: le fasce davvero libere fra tutte le lezioni, pronte da comunicare.
- **Sincronizza con Apple Calendar** via CalDAV, toccando solo gli eventi che ha creato lui.
- **Tiene i compensi** nel mese in cui il bonifico arriva, non in quello della fattura.

Costruito con **Next.js 16** (App Router, standalone), **React 19**, **TypeScript**, **Tailwind 4**,
**Drizzle ORM** su **SQLite**, **Vitest** e un test di fumo nel browser con Playwright. Deploy atomico su Docker
con backup del database prima di ogni rilascio e rollback automatico se la nuova versione non risponde.

> La suite di test non è pubblicata in questo repository: su una copia pulita `npm run test` e `npm run smoke`
> non trovano nulla e il resto del controllo (typecheck, lint, build) gira come sempre.

## Indice

- [Requisiti](#requisiti)
- [Installazione e sviluppo](#installazione-e-sviluppo)
- [Configurazione e variabili d'ambiente](#configurazione-e-variabili-dambiente)
- [Build di produzione senza Docker](#build-di-produzione-senza-docker)
- [Docker](#docker)
- [Database, migration, backup e restore](#database)
- [Come funziona il calendario](#come-funziona-il-calendario)
- [Posta in arrivo: le mail diventano proposte](#posta-in-arrivo)
- [Struttura del progetto](#struttura-del-progetto)

## Requisiti

- Node.js 22 LTS (o superiore) e npm
- Per il deploy: Docker con Docker Compose v2.24+
- Nessun database esterno: SQLite è un file (`data/app.db`)

## Installazione e sviluppo

```bash
npm ci                     # installa le dipendenze dal lockfile
cp .env.example .env       # configura (DeepSeek è opzionale)
npm run dev                # http://localhost:3000
```

Le migration vengono applicate automaticamente all'avvio. Per raggiungere il server di sviluppo da iPhone/iPad
usa `npm run dev -- -H 0.0.0.0` e apri `http://<ip-del-mac>:3000`.

| Comando | Descrizione |
|---|---|
| `npm run dev` | server di sviluppo |
| `npm run typecheck` | controllo TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | test automatici (Vitest; la suite non è inclusa in questo repository) |
| `npm run smoke` | avvia la build di produzione su un database usa e getta e ripercorre nel browser il percorso critico (serve Chrome o Chromium; non incluso in questo repository) |
| `npm run build` | build di produzione (output standalone) |
| `npm run check` | typecheck + lint + test + build |
| `npm run db:generate` | genera una nuova migration dopo una modifica a `src/db/schema.ts` |
| `npm run db:migrate` | applica le migration pendenti |
| `npm run db:backup` | backup consistente del database |

## Configurazione e variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `AGENCY_NAME` | vuoto | Chi assegna i corsi: compare sotto il titolo e nei testi. Vuoto = non si mostra. |
| `AGENCY_ALIASES` | come `AGENCY_NAME` | I modi in cui l'agenzia si nomina nelle sue mail (nome, abbreviazioni, domini), separati da virgola: servono a non confonderla col cliente del corso. |
| `DATABASE_URL` | `file:./data/app.db` | Percorso del file SQLite (`file:` opzionale). In Docker è `file:/data/app.db`. |
| `DEEPSEEK_API_KEY` | vuota | Chiave DeepSeek. **Solo lato server**: non viene mai inviata al browser. Vuota = parser disabilitato. |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Modello DeepSeek. Disponibili: `deepseek-flash` e `deepseek-v4-pro`; gli alias `deepseek-chat` e `deepseek-reasoner` sono stati ritirati e non funzionano più. |
| `DEEPSEEK_REASONING_EFFORT` | `none` | Ragionamento del modello. `none` lo disattiva: per una semplice estrazione basta, ed è più rapido ed economico. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Endpoint API compatibile OpenAI. |
| `MAIL_USER` | vuota | Casella IMAP da leggere (vedi [Posta in arrivo](#posta-in-arrivo)). Vuota = lettura della posta disattivata. |
| `MAIL_APP_PASSWORD` | vuota | Password per app della casella. Sola lettura: il gestionale non invia, non cancella e non segna come letto. |
| `MAIL_SENDERS` | vuota | Mittenti da seguire, separati da virgola: indirizzi (`nome@azienda.it`) o interi domini (`@azienda.it`). Vuoto = tutti quelli della cartella. |
| `MAIL_FOLDER` | `INBOX` | Cartella IMAP da leggere. Su Gmail un'etichetta è una cartella: con un filtro che archivia e applica l'etichetta, qui va il nome dell'etichetta. |
| `MAIL_IMAP_HOST` / `MAIL_IMAP_PORT` | `imap.gmail.com` / `993` | Server IMAP. |
| `MAIL_POLL_MINUTES` | `10` | Ogni quanti minuti controllare la posta. |
| `MAIL_POLL_TOKEN` | vuota | Se impostata, `POST /api/posta` richiede l'intestazione `x-poll-token`. |
| `MIGRATIONS_DIR` | `./drizzle` | Cartella migration (impostata dal Dockerfile). |
| `APP_PORT` / `APP_BIND` | `3000` / `0.0.0.0` | Solo `docker compose`: porta e interfaccia dell'host. |

Il file `.env` non va mai committato (è in `.gitignore`).

**Sicurezza.** L'applicazione è pensata per la sola LAN e non ha autenticazione né registrazione. Non esporla
su Internet (niente port forwarding sul router). Per limitarla a un'interfaccia imposta `APP_BIND` con l'IP LAN del
server. Se in futuro la metti dietro un reverse proxy con un altro hostname, aggiungi l'host a
`experimental.serverActions.allowedOrigins` in `next.config.ts`.

## Build di produzione senza Docker

```bash
npm ci
npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
cp -r drizzle scripts .next/standalone/
cd .next/standalone
DATABASE_URL=file:/percorso/assoluto/app.db HOSTNAME=0.0.0.0 PORT=3000 TZ=Europe/Rome node server.js
```

## Docker

Il container contiene solo l'applicazione. Il database è nella cartella `./data` dell'host, montata in `/data`,
quindi ricostruire, aggiornare o eliminare il container non tocca `app.db`.

### Primo avvio

```bash
cp .env.example .env        # inserisci DEEPSEEK_API_KEY se vuoi il parser
mkdir -p data
sudo chown 1000:1000 data   # il container gira come utente "node" (uid 1000)
docker compose up -d --build
```

Apri `http://<ip-del-server>:3000` da qualsiasi dispositivo della LAN.
Stato: `docker compose ps` (con healthcheck su `/api/health`). Log: `docker compose logs -f app`.

### Aggiornamento

```bash
git pull
docker compose up -d --build   # ricrea il container; le migration pendenti partono all'avvio
```

Consigliato: esegui un backup prima di ogni aggiornamento.

### Migration

All'avvio il container esegue `node scripts/migrate.mjs` e poi il server, e l'app verifica di nuovo al primo accesso
al DB. Le migration già applicate vengono saltate (tabella `__drizzle_migrations`). Per eseguirle a mano:

```bash
docker compose exec app node scripts/migrate.mjs
```

## Deploy sul server (flusso di lavoro)

**Si sviluppa in locale e si fa deploy solo quando la build è stabile.** Il database di riferimento è
quello in produzione: la copia locale serve solo per sviluppo e prove.

Il server si configura una volta, fuori dal repo:

```bash
cp scripts/deploy.config.example scripts/deploy.config   # poi compilalo
```

```bash
./scripts/deploy.sh                      # deploy sul server di scripts/deploy.config
./scripts/deploy.sh --port 9000          # altra porta
./scripts/deploy.sh --host utente@ip --dir /percorso/app
./scripts/deploy.sh --push-env           # aggiorna anche il .env remoto (chiavi API)
./scripts/rollback.sh                    # elenca le release presenti sul server
./scripts/rollback.sh 20260915-193938    # torna a una release precedente
```

Il deploy è **atomico**: ogni fase fallita lascia in esecuzione la versione precedente.

1. Verifica locale: typecheck, lint, test, build e **test di fumo nel browser** (crea un corso, annulla
   una lezione, aggiunge una pausa, cambia calendarizzazione, controlla conflitti, calendario,
   disponibilità e vista iPhone). Se qualcosa non passa, il deploy non parte nemmeno.
2. Copia del codice in `releases/<timestamp>` (rsync, esclusi `node_modules`, `.next`, `data`, `.env`).
3. Build dell'immagine `gestione-corsi:<timestamp>`. Se fallisce, il server non viene toccato.
4. Backup del database **prima** di cambiare versione.
5. Attivazione della nuova release (symlink `current`) e avvio del container.
6. Controllo di salute su `/api/health`: se non risponde entro un minuto, **rollback automatico** alla
   release precedente e log mostrati a schermo.
7. Pulizia: restano le ultime 5 release.

Struttura sul server:

```
/opt/gestione-corsi/
├── current -> releases/20260915-193938    release attiva
├── releases/                              ultime 5 versioni del codice
├── data/                                  database SQLite + backups/  (mai sovrascritto)
└── .env                                   chiavi API (copiato al primo deploy, poi stabile)
```

Requisiti sul server: Docker con Compose v2 e utente nel gruppo `docker`. L'immagine usa **Node 24**:
con Node 22 `npm ci` fallisce sulle dipendenze opzionali di esbuild (bug di npm 10).

## Database

- **Motore:** SQLite in modalità WAL con `foreign_keys = ON`, tramite Drizzle ORM e `better-sqlite3`.
- **Schema:** `src/db/schema.ts`; migration SQL versionate in `drizzle/`.
- **Tabelle:** `courses`, `schedule_rules`, `lessons`, `course_pauses`, `pre_lessons`.
- **Date:** `TEXT 'YYYY-MM-DD'` in ora locale italiana, senza fuso orario. **Orari:** `INTEGER`, minuti dalla
  mezzanotte. Nessuna conversione UTC può spostare una lezione di giorno, e il cambio ora legale/solare non ha
  effetti. CHECK a livello di DB rifiutano date inesistenti, orari incoerenti e prelezioni diverse da 60 minuti.
- **Dati derivati, non memorizzati:** durata lezione, data di fine prevista, ore svolte/programmate/residue,
  disponibilità, conflitti, colori dei corsi.
- **Transazioni:** ogni modifica che tocca regole, pause e lezioni avviene in un'unica transazione SQLite. In caso
  di errore, o se l'utente non conferma un conflitto, non viene salvato nulla.

### Modificare lo schema

```bash
# 1. modifica src/db/schema.ts
npm run db:generate -- --name descrizione_modifica
# 2. verifica il file SQL generato in drizzle/ e committalo
npm run db:migrate            # oppure riavvia l'app
```

### Backup automatico in produzione (consigliato)

```bash
./scripts/install-backup-timer.sh    # una volta sola: installa il timer systemd sul server
./scripts/fetch-backup.sh            # porta l'ultimo backup sul Mac e ne verifica l'integrità
```

Il timer esegue ogni notte alle 02:30 (ora del server) `scripts/backup-cron.sh`, che fa il backup a caldo
dentro il container e conserva 14 giorni di copie in `data/backups/`. `Persistent=true`: se il server era
spento, il backup parte al riavvio successivo.

```bash
ssh utente@server journalctl -u gestione-corsi-backup.service -n 20   # esito degli ultimi backup
ssh utente@server systemctl list-timers gestione-corsi-backup.timer   # prossima esecuzione
```

**Le copie sul server non bastano**: se si guasta la macchina perdi tutto. Lancia `./scripts/fetch-backup.sh`
ogni tanto (o da un cron sul Mac) per tenere una copia fuori dal server.

### Backup manuale

Il backup usa l'API di backup online di SQLite, quindi è consistente anche ad applicazione avviata, e verifica
l'integrità della copia.

```bash
# Docker: crea data/backups/app-AAAAMMGG-HHMMSS.db
docker compose exec app node scripts/backup.mjs

# Locale
npm run db:backup
npm run db:backup -- /percorso/backup/app.db    # destinazione esplicita
```

Esempio di backup notturno con cron sull'host:

```cron
30 2 * * * cd /opt/gestione-corsi && docker compose exec -T app node scripts/backup.mjs >> data/backups/backup.log 2>&1
```

Copia periodicamente `data/backups/` fuori dal server (NAS, disco esterno).
**Non copiare `app.db` a caldo con `cp`**: con il WAL attivo la copia può risultare incompleta. Usa lo script.

### Restore

```bash
docker compose stop app
cp data/app.db data/app.db.prima-del-restore            # sicurezza
rm -f data/app.db-wal data/app.db-shm
cp data/backups/app-AAAAMMGG-HHMMSS.db data/app.db
sudo chown 1000:1000 data/app.db
docker compose start app
```

Senza Docker: ferma l'app, sostituisci il file indicato da `DATABASE_URL` eliminando `-wal` e `-shm`, poi riavvia.

## Come funziona il calendario

Il motore (`src/lib/scheduling/`) è puro, deterministico e coperto da test.

- **Monte ore.** Si generano lezioni finché le ore valide raggiungono il monte ore. Le lezioni annullate valgono 0
  e restano nello storico; l'ultima lezione viene accorciata se basta una parte del suo orario.
- **Fasi di calendarizzazione.** Un corso ha una o più regole (valida dal / al, giorni, orario). "Cambia
  calendarizzazione" chiude la fase attiva il giorno prima, sostituisce le fasi successive e rigenera solo il futuro.
- **Prima lezione diversa.** È una fase di un solo giorno (`valid_from = valid_to`).
- **Lezioni bloccate.** Il ricalcolo non tocca mai le lezioni svolte, annullate, modificate a mano o precedenti
  alla data da cui parte la modifica. Una lezione spostata a mano conserva lo slot originale (`slot_date`), che non
  viene rioccupato.
- **Ricalcolo.** Il motore rigenera le lezioni programmate e automatiche e le confronta con quelle esistenti. Le lezioni
  identiche restano (stessi id), le altre vengono eliminate o inserite. La data di fine prevista è derivata.
- **Festività nazionali.** Escluse automaticamente: Capodanno, Epifania, Pasqua, Lunedì dell'Angelo, 25 aprile,
  1° maggio, 2 giugno, Ferragosto, 4 ottobre (San Francesco, dal 2026), Ognissanti, Immacolata, Natale e
  Santo Stefano. Le feste patronali locali non sono nazionali e non sono incluse.
- **Pause.** Intervalli di date inclusivi, senza lezioni; aggiungerle, modificarle o toglierle ricalcola il futuro.
- **Prelezione.** Dura sempre 1 ora, non entra nel monte ore, occupa calendario e disponibilità.
- **Stato lezioni.** Mai automatico: sei tu a segnare Svolta o Annullata. La dashboard ricorda le lezioni passate
  ancora "Programmata".
- **Conflitti.** Sovrapposizioni tra lezioni e prelezioni di corsi diversi. Prima di salvare una modifica che ne
  crea di nuove compare un avviso di conferma.
- **Disponibilità.** Orario lavorativo lun–ven 09–22, sab 09–13, domenica e festività non disponibili. Prima si
  calcolano gli intervalli liberi reali al minuto, sottraendo lezioni non annullate e prelezioni; poi si ricavano
  slot consecutivi della durata scelta a partire dall'inizio di ogni intervallo.

## Esportare un corso in Apple Calendar (senza collegare l'account)

Dalla pagina del corso, l'icona **Esporta per Apple Calendar** scarica un file `.ics` con tutte le lezioni
non annullate e la prelezione del corso. Si apre con un doppio clic: Apple Calendar chiede in quale calendario
importarlo. Non serve alcuna credenziale.

Il titolo degli eventi è **"Lezione <azienda cliente>"** (per esempio "Lezione ACME SRL") e
**"Prelezione <azienda cliente>"**. Se il corso non ha un'azienda, al suo posto viene usato il referente
allievi così com'è scritto nel campo. Il nome del corso è nella descrizione dell'evento.

Gli eventi del file usano **gli stessi identificatori** della sincronizzazione automatica: se più avanti la
attivi, riconosce gli eventi già importati e li aggiorna invece di duplicarli.

Indirizzo diretto del file: `/corsi/<id>/calendario.ics`.

## Sincronizzazione con Apple Calendar

Il gestionale può scrivere lezioni e prelezioni su un calendario iCloud, così le vedi su iPhone, iPad e Mac
insieme a tutto il resto. Il collegamento è **a senso unico**: il gestionale resta l'unica fonte di verità e le
modifiche fatte in Apple Calendar vengono sovrascritte alla sincronizzazione successiva.

**Configurazione**

1. Su [appleid.apple.com](https://appleid.apple.com) → Accesso e sicurezza → Password per app, crea una password
   (serve l'autenticazione a due fattori).
2. In `.env`:

```bash
ICLOUD_APPLE_ID=tuo@apple.id
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
ICLOUD_CALENDAR_NAME=Lavoro      # nome esatto del calendario, come appare in Apple Calendar
```

3. Riavvia l'app e apri **Calendario → Sincronizza con Apple**: vedi un'anteprima di cosa verrebbe creato,
   aggiornato o rimosso, e nulla viene scritto finché non confermi.

**Garanzie**

- Ogni evento creato dall'app porta un marchio (`X-GESTIONE-CORSI`) e un UID riconoscibile. L'app **legge e
  modifica soltanto i propri eventi**: tutto ciò che è già nel tuo calendario resta intatto, anche se si trova
  nello stesso calendario.
- Vengono esportate solo lezioni non annullate e prelezioni **dalla data odierna in avanti** (orizzonte 400
  giorni): lo storico resta nel gestionale e non riempie il calendario personale.
- Annullare una lezione rimuove l'evento; spostarla lo aggiorna. Gli orari sono "floating", quindi l'ora scritta
  è l'ora locale italiana senza conversioni di fuso.
- Dopo ogni modifica la sincronizzazione parte in background: se iCloud non risponde, il salvataggio nel
  gestionale è comunque già avvenuto e l'errore finisce nei log.
- Il server deve poter raggiungere `caldav.icloud.com` su HTTPS.

## Posta in arrivo

Le mail di incarico, annullamento e cambio orario diventano **proposte da confermare** nella pagina *Posta*.
Nulla entra in calendario da solo: ogni proposta si applica solo quando premi il pulsante.

**Come funziona**

1. Ogni `MAIL_POLL_MINUTES` minuti il server legge la casella in sola lettura (oppure premi *Controlla ora*).
   Al primo avvio fissa il punto di partenza e **non legge l'arretrato**. Il segnalibro è salvato per cartella
   e insieme all'`UIDVALIDITY`: cambiando `MAIL_FOLDER`, o se il server rinumera i messaggi, riparte dalle mail
   nuove invece di rileggere tutto.
2. Vengono tenute solo le mail dei mittenti in `MAIL_SENDERS` — indirizzi interi oppure interi domini scritti
   con la chiocciola davanti (`@agenzia.it`) — riconosciuti anche dietro un inoltro: il vero mittente
   viene cercato nelle intestazioni di inoltro e nella riga «Da:» del testo riportato.
3. DeepSeek legge il testo e dice **di che tipo di mail si tratta** e quali dati contiene. Le decisioni restano
   al gestionale: l'abbinamento al corso, le lezioni da annullare e le righe orario sono calcolati con regole
   deterministiche (`src/lib/mail/match.ts`, `src/server/mail-service.ts`) e coperti da test.
   L'abbinamento richiede che a corrispondere sia il **cliente o l'allievo**: il solo titolo non basta, perché
   corsi diversi hanno spesso lo stesso nome e la mail può riguardare un corso che in gestionale non c'è.
   Se però la mail cita il **numero d'incarico** e quel numero è salvato sul corso, quello decide da solo.
4. La proposta finisce nella pagina *Posta* con scritto cosa succederebbe. Confermandola valgono gli stessi
   controlli del resto dell'applicazione: storico mai riscritto, avviso sulle sovrapposizioni, ricalcolo del
   monte ore.

| Tipo di mail | Proposta |
|---|---|
| Corso nuovo | apre il modulo di creazione già compilato |
| Annullamento | annulla le lezioni indicate; le ore tornano in coda al corso |
| Cambio orario o giorno aggiunto | aggiunge il giorno se è libero, altrimenti propone il cambio di calendarizzazione |
| Conferma corso (con l'elenco delle date) | confronta le date confermate col calendario generato e segnala le differenze |
| Chiusura corso | propone di archiviare il corso, avvisando se restano lezioni da segnare o ore scoperte |
| Altro | resta da leggere, senza proposte |

**Caselle Outlook/Microsoft.** Dal 16/09/2024 gli account personali non accettano più IMAP con password per
app: serve OAuth2, e registrare un'app su Entra richiede una sottoscrizione Azure. La via pratica è una regola
su Outlook che inoltra le mail dei mittenti seguiti a una casella Gmail, letta con una password per app.
Il codice per leggere Outlook via Microsoft Graph è già pronto in `src/lib/outlook/`: si attiva mettendo
`OUTLOOK_EMAIL` e `OUTLOOK_CLIENT_ID` nel `.env` e lanciando `npm run posta:accedi`.

**Controllo periodico.** Di norma lo fa l'applicazione stessa (`src/instrumentation.ts`). In alternativa si può
richiamare `POST /api/posta` da un timer di sistema: `./scripts/install-mail-timer.sh` installa quello systemd.

## Struttura del progetto

```
├── Dockerfile, docker-compose.yml, .env.example
├── drizzle/                    migration SQL generate da drizzle-kit
├── scripts/
│   ├── migrate.mjs             applica le migration
│   └── backup.mjs              backup online + integrity check
└── src/
    ├── app/                    pagine (App Router)
    │   ├── page.tsx            Dashboard
    │   ├── corsi/              elenco, nuovo corso, pagina corso [id]
    │   ├── calendario/         vista settimana / mese
    │   ├── disponibilita/      slot liberi
    │   ├── archivio/           corsi conclusi
    │   └── api/health/         healthcheck
    ├── components/
    │   ├── ui/                 componenti shadcn/ui
    │   ├── course/             form nuovo corso, sezioni pagina corso, controlli lezione
    │   ├── calendar/           calendario generale
    │   └── availability/       vista disponibilità
    ├── db/                     schema Drizzle e connessione (migration all'avvio)
    ├── lib/
    │   ├── dates.ts            date civili, orari, formattazione IT, "oggi" a Roma
    │   ├── scheduling/         motore: generate/recalculate, festività, pause, disponibilità, conflitti (+ test)
    │   └── deepseek/           parser mail (solo server) + normalizzazione deterministica (+ test)
    ├── server/
    │   ├── course-service.ts   operazioni transazionali e verifica conflitti
    │   ├── queries.ts          letture per le pagine
    │   └── actions.ts          server actions con validazione zod
    └── instrumentation.ts      apertura DB + migration all'avvio
```

## Licenza

[MIT](LICENSE).

Il font incorporato è un'eccezione: `src/app/fonts/instrument-sans.woff2` è
**Instrument Sans**, distribuito con la [SIL Open Font License 1.1](src/app/fonts/OFL.txt)
e non coperto dalla licenza MIT (vedi [NOTICE](src/app/fonts/NOTICE.md)).
