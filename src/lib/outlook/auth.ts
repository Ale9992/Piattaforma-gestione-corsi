import fs from "node:fs";
import path from "node:path";
import { tokenFilePath } from "./config";

/** Endpoint OAuth per gli account Microsoft personali. */
export const OAUTH_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
/** Sola lettura della posta, più il rinnovo automatico senza rifare l'accesso. */
export const SCOPE = "offline_access Mail.Read";

export class OutlookAuthError extends Error {}

export interface StoredToken {
  refreshToken: string;
  accessToken: string;
  /** Scadenza dell'access token in millisecondi epoch. */
  expiresAt: number;
  account: string;
}

export type Fetcher = typeof fetch;

export function readStoredToken(file = tokenFilePath()): StoredToken | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredToken>;
    if (!raw.refreshToken) return null;
    return {
      refreshToken: raw.refreshToken,
      accessToken: raw.accessToken ?? "",
      expiresAt: raw.expiresAt ?? 0,
      account: raw.account ?? "",
    };
  } catch {
    return null;
  }
}

export function writeStoredToken(token: StoredToken, file = tokenFilePath()): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(token, null, 2), { mode: 0o600 });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Traduce gli errori di Microsoft in messaggi comprensibili. */
export function describeTokenError(body: TokenResponse): string {
  switch (body.error) {
    case "invalid_grant":
      return "Autorizzazione scaduta o revocata: rifai l'accesso con «npm run posta:accedi».";
    case "invalid_client":
    case "unauthorized_client":
      return "OUTLOOK_CLIENT_ID non valido, oppure l'app non consente i flussi client pubblici.";
    case "expired_token":
      return "Il codice di accesso è scaduto: riprova.";
    default:
      return body.error_description?.split("\n")[0] ?? body.error ?? "Errore sconosciuto.";
  }
}

export async function requestToken(
  params: Record<string, string>,
  fetcher: Fetcher = fetch,
): Promise<TokenResponse> {
  const response = await fetcher(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  return (await response.json().catch(() => ({}))) as TokenResponse;
}

/** Margine di sicurezza: si rinnova poco prima della scadenza vera. */
const EARLY_REFRESH_MS = 120_000;

export function isExpired(token: StoredToken, now = Date.now()): boolean {
  return !token.accessToken || token.expiresAt - EARLY_REFRESH_MS <= now;
}

/**
 * Restituisce un access token valido, rinnovandolo se serve. Il refresh token
 * viene ruotato da Microsoft a ogni rinnovo: si risalva sempre.
 */
export async function getAccessToken(
  clientId: string,
  options: { fetcher?: Fetcher; file?: string; now?: number } = {},
): Promise<string> {
  const file = options.file ?? tokenFilePath();
  const stored = readStoredToken(file);
  if (!stored) {
    throw new OutlookAuthError(
      "Accesso a Outlook non ancora autorizzato: esegui «npm run posta:accedi».",
    );
  }
  if (!isExpired(stored, options.now ?? Date.now())) return stored.accessToken;

  const body = await requestToken(
    {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      scope: SCOPE,
    },
    options.fetcher,
  );
  if (!body.access_token || !body.refresh_token) {
    throw new OutlookAuthError(describeTokenError(body));
  }
  const token: StoredToken = {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresAt: (options.now ?? Date.now()) + (body.expires_in ?? 3600) * 1000,
    account: stored.account,
  };
  writeStoredToken(token, file);
  return token.accessToken;
}
