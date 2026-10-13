/**
 * Copia negli appunti.
 *
 * `navigator.clipboard` esiste solo in contesto sicuro: il gestionale gira in
 * HTTP sulla rete di casa, quindi serve il ripiego con la textarea nascosta.
 */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}
