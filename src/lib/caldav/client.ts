import { readCalendarObject, type RemoteEventInfo } from "./ics";

/**
 * Client CalDAV minimale (RFC 4791) per iCloud.
 * Autenticazione Basic con Apple ID + password per app (richiede la verifica in due passaggi).
 */

export class CalDavError extends Error {}

export interface CalDavAuth {
  appleId: string;
  appPassword: string;
  baseUrl?: string;
}

export const DEFAULT_CALDAV_URL = "https://caldav.icloud.com";

export interface CalendarInfo {
  url: string;
  displayName: string;
}

export interface RemoteEvent extends RemoteEventInfo {
  href: string;
}

type Fetcher = typeof fetch;

function authHeader(auth: CalDavAuth): string {
  return `Basic ${Buffer.from(`${auth.appleId}:${auth.appPassword}`).toString("base64")}`;
}

async function dav(
  auth: CalDavAuth,
  url: string,
  init: { method: string; depth?: string; body?: string; contentType?: string; headers?: Record<string, string> },
  fetcher: Fetcher = fetch,
): Promise<{ status: number; text: string; url: string }> {
  let current = url;
  for (let redirects = 0; redirects < 5; redirects++) {
    let response: Response;
    try {
      response = await fetcher(current, {
        method: init.method,
        headers: {
          Authorization: authHeader(auth),
          "Content-Type": init.contentType ?? "application/xml; charset=utf-8",
          ...(init.depth ? { Depth: init.depth } : {}),
          ...init.headers,
        },
        body: init.body,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "rete";
      throw new CalDavError(`iCloud non raggiungibile (${reason}).`);
    }

    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new CalDavError("Risposta iCloud con redirect senza destinazione.");
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError(
        "iCloud ha rifiutato le credenziali: verifica Apple ID e password per app (ICLOUD_APPLE_ID / ICLOUD_APP_PASSWORD).",
      );
    }
    const text = await response.text();
    if (response.status >= 400) {
      throw new CalDavError(`Errore iCloud (HTTP ${response.status}).`);
    }
    return { status: response.status, text, url: current };
  }
  throw new CalDavError("Troppi redirect da iCloud.");
}

/** Rimuove i prefissi di namespace per poter leggere l'XML con espressioni regolari. */
function stripNamespaces(xml: string): string {
  return xml.replace(/<\/?[A-Za-z0-9_.-]+:/g, (m) => (m.startsWith("</") ? "</" : "<"));
}

function responses(xml: string): string[] {
  return [...stripNamespaces(xml).matchAll(/<response\b[\s\S]*?<\/response>/g)].map((m) => m[0]);
}

function tagValue(fragment: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(fragment);
  return m ? m[1].trim() : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Elenco dei calendari dell'account, con il nome che vedi in Apple Calendar. */
export async function listCalendars(auth: CalDavAuth, fetcher: Fetcher = fetch): Promise<CalendarInfo[]> {
  const base = auth.baseUrl ?? DEFAULT_CALDAV_URL;

  const principalResponse = await dav(
    auth,
    `${base}/`,
    {
      method: "PROPFIND",
      depth: "0",
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
    },
    fetcher,
  );
  const principalHref = tagValue(
    tagValue(stripNamespaces(principalResponse.text), "current-user-principal") ?? "",
    "href",
  );
  if (!principalHref) throw new CalDavError("iCloud non ha restituito il principale dell'account.");

  const principalUrl = new URL(principalHref, principalResponse.url).toString();
  const homeResponse = await dav(
    auth,
    principalUrl,
    {
      method: "PROPFIND",
      depth: "0",
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>`,
    },
    fetcher,
  );
  const homeHref = tagValue(tagValue(stripNamespaces(homeResponse.text), "calendar-home-set") ?? "", "href");
  if (!homeHref) throw new CalDavError("iCloud non ha restituito la cartella dei calendari.");

  const homeUrl = new URL(homeHref, homeResponse.url).toString();
  const listResponse = await dav(
    auth,
    homeUrl,
    {
      method: "PROPFIND",
      depth: "1",
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><displayname/><resourcetype/><C:supported-calendar-component-set/></prop></propfind>`,
    },
    fetcher,
  );

  const calendars: CalendarInfo[] = [];
  for (const entry of responses(listResponse.text)) {
    if (!/<calendar\b/i.test(entry)) continue;
    // Solo calendari di eventi: esclude promemoria e liste attività.
    if (/name="VTODO"/i.test(entry) && !/name="VEVENT"/i.test(entry)) continue;
    const href = tagValue(entry, "href");
    const displayName = tagValue(entry, "displayname");
    if (!href || !displayName) continue;
    calendars.push({ url: new URL(href, listResponse.url).toString(), displayName: decodeXml(displayName) });
  }
  return calendars;
}

export async function findCalendarByName(
  auth: CalDavAuth,
  name: string,
  fetcher: Fetcher = fetch,
): Promise<CalendarInfo> {
  const calendars = await listCalendars(auth, fetcher);
  const wanted = name.trim().toLowerCase();
  const match = calendars.find((c) => c.displayName.trim().toLowerCase() === wanted);
  if (!match) {
    throw new CalDavError(
      `Calendario "${name}" non trovato su iCloud. Disponibili: ${calendars.map((c) => c.displayName).join(", ") || "nessuno"}.`,
    );
  }
  return match;
}

/** Eventi presenti nel calendario nell'intervallo indicato (date ISO). */
export async function listEvents(
  auth: CalDavAuth,
  calendarUrl: string,
  range: { from: string; to: string },
  fetcher: Fetcher = fetch,
): Promise<RemoteEvent[]> {
  const stamp = (date: string, time: string) => `${date.replace(/-/g, "")}T${time}`;
  const report = await dav(
    auth,
    calendarUrl,
    {
      method: "REPORT",
      depth: "1",
      body: `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${stamp(range.from, "000000Z")}" end="${stamp(range.to, "235959Z")}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`,
    },
    fetcher,
  );

  const events: RemoteEvent[] = [];
  for (const entry of responses(report.text)) {
    const href = tagValue(entry, "href");
    const data = tagValue(entry, "calendar-data");
    if (!href || !data) continue;
    events.push({ href: new URL(href, report.url).toString(), ...readCalendarObject(decodeXml(data)) });
  }
  return events;
}

export async function putEvent(
  auth: CalDavAuth,
  calendarUrl: string,
  uid: string,
  ics: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const url = new URL(`${encodeURIComponent(uid)}.ics`, calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`);
  await putEventAt(auth, url.toString(), ics, fetcher);
}

/**
 * Riscrive un evento esistente al suo indirizzo. Un evento importato a mano può
 * avere un indirizzo diverso da `<uid>.ics`: scrivere altrove creerebbe un
 * secondo oggetto con lo stesso UID, che iCloud rifiuta.
 */
export async function putEventAt(auth: CalDavAuth, href: string, ics: string, fetcher: Fetcher = fetch): Promise<void> {
  await dav(auth, href, { method: "PUT", body: ics, contentType: "text/calendar; charset=utf-8" }, fetcher);
}

export async function deleteEvent(auth: CalDavAuth, href: string, fetcher: Fetcher = fetch): Promise<void> {
  await dav(auth, href, { method: "DELETE" }, fetcher);
}
