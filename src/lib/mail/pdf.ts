import "server-only";
// Lettore PDF senza pezzi nativi: `pdf-parse` tirava dentro @napi-rs/canvas, che
// non finisce nell'immagine di produzione e faceva fallire la lettura in silenzio.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Testo di un PDF (la lettera d'incarico allegata alla mail). Se il file non è
 * leggibile — PDF scansionato, protetto o corrotto — si restituisce stringa
 * vuota: il gestionale prosegue senza compenso invece di fermarsi.
 */
export async function estraiTestoPdf(contenuto: Buffer): Promise<string> {
  try {
    const documento = await getDocument({
      data: new Uint8Array(contenuto),
      // Serve solo il testo: niente caratteri da disegnare.
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
    try {
      const pagine: string[] = [];
      for (let n = 1; n <= documento.numPages; n++) {
        const pagina = await documento.getPage(n);
        const contenutoPagina = await pagina.getTextContent();
        pagine.push(
          contenutoPagina.items.map((item) => ("str" in item ? item.str : "")).join(" "),
        );
      }
      return pagine.join("\n");
    } finally {
      await documento.cleanup();
    }
  } catch {
    return "";
  }
}
