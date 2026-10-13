"use client";

import { useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon, VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/common";
import { buttonVariants } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { APP_TEAMS, linkApp } from "@/lib/mail/meeting";

interface Props {
  url: string;
  user: string;
  password: string;
}

/**
 * Accesso alla riunione del corso, come arriva nella mail di conferma.
 *
 * Il bottone apre l'applicazione Teams, non il browser: è lo stesso indirizzo
 * scritto con lo schema `msteams:`, che il Teams installato registra a sistema.
 * Il collegamento nel browser resta lì accanto per i casi in cui l'applicazione
 * non c'è — un altro computer, il telefono di qualcun altro.
 */
export function MeetingAccess({ url, user, password }: Props) {
  const [visibile, setVisibile] = useState(false);
  if (!url && !user && !password) return null;
  // Con l'invito si entra diritti nella riunione; senza, si apre comunque
  // l'applicazione e si accede con le credenziali qui sotto.
  const app = linkApp(url) || APP_TEAMS;

  async function copia(valore: string, cosa: string) {
    try {
      await copyText(valore);
      toast.success(`${cosa} copiat${cosa === "Password" ? "a" : "o"}`);
    } catch {
      toast.error("Copia non riuscita.");
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="label-group">Riunione Teams</div>
        <div className="flex items-center gap-2">
          <a href={app} className={buttonVariants({ size: "sm" })}>
            <VideoIcon />
            Apri Teams
          </a>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              nel browser
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">accedi con queste credenziali</span>
          )}
        </div>
      </div>

      {user || password ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t pt-3 text-sm sm:grid-cols-2">
          {user ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Utente</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="tabular truncate">{user}</span>
                <IconButton label="Copia l'utente" onClick={() => void copia(user, "Utente")}>
                  <CopyIcon className="size-3.5" />
                </IconButton>
              </dd>
            </div>
          ) : null}
          {password ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Password</dt>
              <dd className="flex min-w-0 items-center gap-1">
                {/* Coperta finché non serve: la scheda del corso si apre anche
                    davanti all'allievo, in condivisione schermo. */}
                <span className="tabular truncate">{visibile ? password : "••••••••"}</span>
                <IconButton
                  label={visibile ? "Nascondi la password" : "Mostra la password"}
                  onClick={() => setVisibile((v) => !v)}
                >
                  {visibile ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
                </IconButton>
                <IconButton label="Copia la password" onClick={() => void copia(password, "Password")}>
                  <CopyIcon className="size-3.5" />
                </IconButton>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
