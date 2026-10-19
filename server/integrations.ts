/** GLPI integration lives in glpi.ts (read-only client), glpi-analysis.ts and glpi-sync.ts. */

/** Future signature providers must implement this; no provider is active in v1.
 * Clicksign/Clint numbering and signature status remain manual confirmations. */
export interface SignatureProvider {
  send(
    documentId: string,
    signers: { name: string; email: string }[],
  ): Promise<{ externalId: string }>;
  status(
    externalId: string,
  ): Promise<"sent" | "pending" | "signed" | "rejected">;
  downloadSigned(externalId: string): Promise<Buffer>;
}
