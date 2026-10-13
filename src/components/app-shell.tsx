"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArchiveIcon,
  BarChart3Icon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClockIcon,
  InboxIcon,
  LayoutDashboardIcon,
  PlusIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", short: "Oggi", icon: LayoutDashboardIcon },
  { href: "/corsi", label: "Corsi", short: "Corsi", icon: BookOpenIcon },
  { href: "/calendario", label: "Calendario", short: "Calendario", icon: CalendarDaysIcon },
  { href: "/disponibilita", label: "Disponibilità", short: "Liberi", icon: ClockIcon },
  { href: "/posta", label: "Posta", short: "Posta", icon: InboxIcon },
  { href: "/report", label: "Report", short: "Report", icon: BarChart3Icon },
  { href: "/archivio", label: "Archivio", short: "Archivio", icon: ArchiveIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Pallino con il numero di mail da leggere, accanto alla voce Posta. */
function MailBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent-ink px-1.5 text-[10.5px] font-semibold leading-[17px] text-background",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell({
  children,
  pendingMail = 0,
  agency = "",
}: {
  children: ReactNode;
  pendingMail?: number;
  /** Chi assegna i corsi, da configurazione: vuoto non si mostra. */
  agency?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      {/* Navigazione desktop e iPad */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r bg-sidebar md:flex">
        <div className="px-6 pb-6 pt-7">
          <Link href="/" className="block text-[15px] font-semibold leading-tight">
            Gestione Corsi
          </Link>
          {agency ? <span className="text-xs text-muted-foreground">{agency}</span> : null}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-foreground shadow-[inset_2px_0_0_var(--accent-ink)]"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-[18px]", active && "text-accent-ink")} />
                {label}
                {href === "/posta" ? <MailBadge count={pendingMail} className="ml-auto" /> : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Intestazione mobile: un titolo, una sola azione */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Link href="/" className="font-semibold">
          Gestione Corsi
        </Link>
        <Link
          href="/corsi/nuovo"
          aria-label="Nuovo corso"
          className={cn(buttonVariants({ size: "icon" }), "size-11 rounded-xl")}
        >
          <PlusIcon className="size-5" />
        </Link>
      </header>

      <main className="px-4 pb-28 pt-5 sm:px-6 md:ml-[232px] md:pb-12 md:pt-8 lg:px-10">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>

      {/* Barra inferiore mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ href, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[10.5px]",
                active ? "font-medium text-accent-ink" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <Icon className="size-[21px]" />
                {href === "/posta" ? (
                  <MailBadge count={pendingMail} className="absolute -right-2.5 -top-1.5" />
                ) : null}
              </span>
              {short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
