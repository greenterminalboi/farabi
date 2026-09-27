/**
 * Two terms are the same definition entry when their keys match: trimmed, inner whitespace
 * collapsed, case ignored (Feature 2, FR-034). Shared by the server and the text marker.
 */
export function termKey(term: string): string {
  return term.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
