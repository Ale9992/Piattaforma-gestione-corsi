import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, ClockIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { COURSE_STATUS_CLASS, COURSE_STATUS_LABEL, LESSON_STATUS_LABEL } from "@/lib/format";
import type { CourseStatus, LessonStatus } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

/** Select nativo: più veloce su iPhone. `text-base` evita lo zoom automatico di iOS. */
export const nativeSelectClass =
  "h-8 rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description ? (
          <div className="mt-1 text-[13px] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Sezione: titolo su un filo, niente cornice. Le cornici restano solo dove
 * rappresentano un oggetto (una scheda corso), non per raggruppare del testo.
 */
export function Section({
  title,
  actions,
  children,
  className,
  card = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  card?: boolean;
}) {
  return (
    <section className={cn(card && "rounded-xl border bg-card p-3 sm:p-4", className)}>
      {title ? (
        <div
          className={cn(
            "mb-2 flex flex-wrap items-center justify-between gap-2 pb-2",
            !card && "border-b",
          )}
        >
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Fascia dei numeri: celle separate da un filo, cifre grandi e tabulari. */
/** Numeri in evidenza: una scheda per dato, leggibili in un colpo d'occhio. */
export function StatCards({
  items,
}: {
  items: { label: string; value: string; hint?: string; href?: string; accent?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((item) => {
        const contenuto = (
          <>
            <div className="label-group">{item.label}</div>
            <div
              className={cn(
                "tabular mt-1.5 text-[26px] font-medium leading-none sm:text-[30px]",
                item.accent && "text-accent-ink",
              )}
            >
              {item.value}
            </div>
            {item.hint ? (
              <div className="tabular mt-1.5 truncate text-xs text-muted-foreground">{item.hint}</div>
            ) : null}
          </>
        );
        const classi = "rounded-xl border bg-card px-3.5 py-3 sm:px-4 sm:py-3.5";
        return item.href ? (
          <Link key={item.label} href={item.href} className={cn(classi, "transition-colors hover:border-input")}>
            {contenuto}
          </Link>
        ) : (
          <div key={item.label} className={classi}>
            {contenuto}
          </div>
        );
      })}
    </div>
  );
}

/** Avviso: una riga fra due fili, non una scatola colorata. */
export function NoticeRow({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "neutral";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-y py-2.5 text-[13px]">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", tone === "warn" ? "bg-warn" : "bg-muted-foreground")}
      />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function CourseStatusBadge({ status, className }: { status: CourseStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", COURSE_STATUS_CLASS[status], className)}>
      {COURSE_STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Lo stato della lezione si legge a sinistra della riga, con un segno.
 * "Programmata" è il caso normale e non si scrive.
 */
export function LessonStatusMark({
  status,
  overdue = false,
  className,
}: {
  status: LessonStatus;
  overdue?: boolean;
  className?: string;
}) {
  const label = overdue && status === "PLANNED" ? "Da segnare" : LESSON_STATUS_LABEL[status];
  const icon =
    status === "COMPLETED" ? (
      <CheckIcon className="size-[15px] stroke-[2.6] text-ok" />
    ) : status === "CANCELLED" ? (
      <XIcon className="size-[15px] stroke-[2.4] text-danger" />
    ) : overdue ? (
      <ClockIcon className="size-[15px] text-warn" />
    ) : null;

  return (
    <span className={cn("inline-flex size-[15px] shrink-0 items-center justify-center", className)} title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Azione a icona: area ampia (30px, 44px al tocco), forma distinta e
 * suggerimento al passaggio del mouse. Senza etichetta le icone sono indovinelli.
 */
/** Stile condiviso fra pulsante e link a icona. */
export function iconButtonClass(
  tone: "neutral" | "ok" | "danger" | "accent" = "neutral",
  size: "sm" | "md" = "sm",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center rounded-md border bg-background transition-colors",
    "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-45",
    size === "sm" ? "size-[30px]" : "size-[34px]",
    tone === "neutral" && "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
    tone === "ok" && "border-ok-line text-ok hover:bg-ok-tint",
    tone === "danger" && "border-input text-danger hover:border-danger-line hover:bg-danger-tint",
    tone === "accent" && "border-input text-accent-ink hover:bg-accent-tint",
    className,
  );
}

function IconTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11.5px] text-background opacity-0 transition-opacity group-hover/icon:opacity-100 md:block"
    >
      {label}
    </span>
  );
}

/** Come IconButton, ma è un link: serve per gli scaricamenti. */
export function IconLink({
  label,
  href,
  download,
  tone = "neutral",
  size = "sm",
  className,
  children,
}: {
  label: string;
  href: string;
  download?: boolean;
  tone?: "neutral" | "ok" | "danger" | "accent";
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className="group/icon relative inline-flex">
      <a href={href} aria-label={label} download={download} className={iconButtonClass(tone, size, className)}>
        {children}
      </a>
      <IconTooltip label={label} />
    </span>
  );
}

export function IconButton({
  label,
  tone = "neutral",
  size = "sm",
  className,
  children,
  ...props
}: {
  label: string;
  tone?: "neutral" | "ok" | "danger" | "accent";
  size?: "sm" | "md";
  children: ReactNode;
} & Omit<React.ComponentProps<"button">, "aria-label" | "title">) {
  return (
    <span className="group/icon relative inline-flex">
      <button
        type="button"
        aria-label={label}
        {...props}
        className={iconButtonClass(tone, size, className)}
      >
        {children}
      </button>
      <IconTooltip label={label} />
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Barra unica segmentata: svolte, programmate, resto. */
export function ProgressBar({
  total,
  completed,
  planned,
  fill = "bg-ok",
  className,
}: {
  total: number;
  completed: number;
  planned: number;
  fill?: string;
  className?: string;
}) {
  const pct = (v: number) => (total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0);
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className={fill} style={{ width: `${pct(completed)}%` }} />
      <div
        className={cn(fill, "opacity-30")}
        style={{ width: `${pct(Math.min(planned, Math.max(0, total - completed)))}%` }}
      />
    </div>
  );
}

export function ConflictMark({ className }: { className?: string }) {
  return (
    <span title="Sovrapposizione con un altro corso" className={cn("inline-flex", className)}>
      <AlertTriangleIcon className="size-3.5 text-warn" />
      <span className="sr-only">Sovrapposizione con un altro corso</span>
    </span>
  );
}

/** Conferma prima di un'azione che non si torna indietro. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
