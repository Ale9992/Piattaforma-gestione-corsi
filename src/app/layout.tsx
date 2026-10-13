import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/app-shell";
import { MutationProvider } from "@/components/mutation-provider";
import { Toaster } from "@/components/ui/sonner";
import { agencyName } from "@/lib/agency";
import { countPendingMail } from "@/server/mail-service";
import "./globals.css";

// Font incorporato nel progetto: la build non dipende dalla rete.
const instrumentSans = localFont({
  src: "./fonts/instrument-sans.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-instrument-sans",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "Gestione Corsi", template: "%s · Gestione Corsi" },
  description: "Gestionale dei corsi per un formatore che lavora su incarico",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1d" },
  ],
};

/** Applica il tema di sistema prima del primo disegno, così non c'è sfarfallio. */
const themeScript = `try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Mail in attesa: il numero accanto alla voce "Posta".
  const pendingMail = countPendingMail();
  return (
    <html lang="it" className={`${instrumentSans.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <MutationProvider>
          <AppShell pendingMail={pendingMail} agency={agencyName()}>
            {children}
          </AppShell>
        </MutationProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
