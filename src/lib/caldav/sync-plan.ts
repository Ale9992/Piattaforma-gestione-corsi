import type { RemoteEvent } from "./client";
import { eventHash, eventUid, type CalendarEventData } from "./ics";

export interface SyncPlan {
  create: CalendarEventData[];
  update: { event: CalendarEventData; href: string }[];
  remove: { href: string; uid: string }[];
  unchanged: number;
  /** Eventi altrui presenti nel calendario: mai toccati. */
  ignored: number;
}

/**
 * Decide cosa scrivere sul calendario Apple. Funzione pura.
 *
 * Regola fondamentale: vengono considerati SOLO gli eventi creati da questa
 * applicazione (marchio + UID riconoscibile). Qualsiasi altro evento del
 * calendario viene ignorato e non può essere modificato o eliminato.
 */
export function planCalendarSync(
  desired: readonly CalendarEventData[],
  remote: readonly RemoteEvent[],
): SyncPlan {
  const owned = new Map<string, RemoteEvent>();
  let ignored = 0;
  for (const event of remote) {
    if (event.owned && event.uid) owned.set(event.uid, event);
    else ignored++;
  }

  const plan: SyncPlan = { create: [], update: [], remove: [], unchanged: 0, ignored };
  const seen = new Set<string>();

  for (const event of desired) {
    const uid = eventUid(event.kind, event.id);
    seen.add(uid);
    const existing = owned.get(uid);
    if (!existing) plan.create.push(event);
    else if (existing.hash === eventHash(event)) plan.unchanged++;
    else plan.update.push({ event, href: existing.href });
  }

  for (const [uid, event] of owned) {
    if (!seen.has(uid)) plan.remove.push({ href: event.href, uid });
  }

  plan.create.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
  plan.remove.sort((a, b) => a.uid.localeCompare(b.uid));
  return plan;
}

/** Nessuna scrittura necessaria su iCloud. */
export function isEmptyPlan(plan: SyncPlan): boolean {
  return plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
}
