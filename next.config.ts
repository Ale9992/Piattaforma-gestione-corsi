import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonomo per Docker (.next/standalone/server.js).
  output: "standalone",
  // Il progetto vive dentro un repository più grande: fissa la root di tracing.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // Esterni: tracciati in .next/standalone/node_modules, usati anche da scripts/migrate.mjs.
  // Librerie di sistema (file, socket, PDF): vanno lasciate a Node e copiate in
  // .next/standalone/node_modules, altrimenti in produzione mancano e la lettura
  // fallisce in silenzio.
  serverExternalPackages: ["better-sqlite3", "drizzle-orm", "pdfjs-dist", "imapflow", "mailparser"],
  // pdfjs carica il suo "worker" a runtime, quindi il tracciamento non lo vede:
  // senza questa riga il file manca nell'immagine e la lettura dei PDF fallisce
  // solo in produzione, al primo contratto da leggere.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
