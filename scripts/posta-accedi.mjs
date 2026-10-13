#!/usr/bin/env node
// Autorizza una volta sola la lettura della casella Outlook (Microsoft Graph).
// Mostra un codice da confermare nel browser; salva le credenziali accanto al
// database, nel volume persistente. Sola lettura: permesso Mail.Read.
//
//   npm run posta:accedi
//
import fs from "node:fs";
import path from "node:path";

const OAUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE = "offline_access Mail.Read";

for (const file of [".env", ".env.local"]) leggiEnv(file);

const clientId = process.env.OUTLOOK_CLIENT_ID?.trim();
const email = process.env.OUTLOOK_EMAIL?.trim().toLowerCase() ?? "";
if (!clientId) {
  console.error("Manca OUTLOOK_CLIENT_ID nel file .env: registra l'app su entra.microsoft.com.");
  process.exit(1);
}

const tokenFile = percorsoToken();
const device = await post(`${OAUTH}/devicecode`, { client_id: clientId, scope: SCOPE });
if (!device.device_code) {
  console.error(`Richiesta rifiutata: ${device.error_description ?? device.error ?? "errore sconosciuto"}`);
  process.exit(1);
}

console.log(`\n  1. Apri  ${device.verification_uri}`);
console.log(`  2. Inserisci il codice  ${device.user_code}`);
console.log(`  3. Accedi con ${email || "la casella da monitorare"} e consenti la lettura della posta\n`);
console.log("In attesa della conferma…");

const scadenza = Date.now() + (device.expires_in ?? 900) * 1000;
const attesa = Math.max(5, device.interval ?? 5) * 1000;
let token = null;
while (Date.now() < scadenza) {
  await new Promise((r) => setTimeout(r, attesa));
  const body = await post(`${OAUTH}/token`, {
    client_id: clientId,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: device.device_code,
  });
  if (body.access_token) {
    token = body;
    break;
  }
  if (body.error === "authorization_pending") continue;
  if (body.error === "slow_down") continue;
  console.error(`\n✖ ${body.error_description?.split("\n")[0] ?? body.error}`);
  process.exit(1);
}
if (!token) {
  console.error("\n✖ Tempo scaduto senza conferma.");
  process.exit(1);
}

const account = await chiAccede(token.access_token);
if (email && account && account !== email) {
  console.error(`\n✖ Hai autorizzato ${account}, ma OUTLOOK_EMAIL è ${email}. Nessuna credenziale salvata.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
fs.writeFileSync(
  tokenFile,
  JSON.stringify(
    {
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      account: account || email,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`\n✔ Accesso autorizzato per ${account || email}`);
console.log(`  Credenziali salvate in ${tokenFile} (sola lettura della posta).`);
console.log("  Per revocarlo: account.microsoft.com → Privacy → App e servizi con accesso.");

// ---------------------------------------------------------------------------

async function post(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return response.json().catch(() => ({}));
}

async function chiAccede(accessToken) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return "";
  const data = await response.json().catch(() => ({}));
  return (data.mail ?? data.userPrincipalName ?? "").toLowerCase();
}

function percorsoToken() {
  const raw = process.env.DATABASE_URL?.trim() || "./data/app.db";
  const file = raw.startsWith("file:") ? raw.slice(5) : raw;
  return path.join(path.dirname(path.resolve(process.cwd(), file)), "outlook-token.json");
}

/** Legge il .env senza dipendenze: solo righe CHIAVE=valore. */
function leggiEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
