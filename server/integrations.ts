/** Adapters must return normalized read-only tickets; secrets stay in server env. */
export interface GlpiTicket {
  externalId: string;
  schoolId: string;
  type: string;
  priority: "Normal" | "Alta" | "Urgente";
}
export interface GlpiPage {
  tickets: GlpiTicket[];
  nextCursor: string | null;
}
export interface GlpiAdapter {
  mode: "demo" | "real";
  readPage(cursor: string | null, signal: AbortSignal): Promise<GlpiPage>;
}
export class DemoGlpiAdapter implements GlpiAdapter {
  mode = "demo" as const;
  async readPage(
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<GlpiPage> {
    signal.throwIfAborted();
    const page = cursor ? Number(cursor) : 0;
    if (page < 0 || page > 1) throw Error("Página demonstrativa inválida.");
    return {
      tickets: [0, 1].map((i) => ({
        externalId: "DEMO-" + (page * 2 + i + 1),
        schoolId: "s0",
        type: "Contrato de garantia",
        priority: "Normal",
      })),
      nextCursor: page === 0 ? "1" : null,
    };
  }
}
export class UnconfiguredGlpiAdapter implements GlpiAdapter {
  mode = "real" as const;
  async readPage(): Promise<GlpiPage> {
    throw Error(
      "Modo real bloqueado: valide a documentação oficial da versão e API da instalação antes de implementar o adaptador.",
    );
  }
}
export async function importPages(
  adapter: GlpiAdapter,
  consume: (tickets: GlpiTicket[]) => void,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let cursor: string | null = null,
    pages = 0;
  const visited = new Set<string>();
  try {
    do {
      if (++pages > 100)
        throw Error("Limite de 100 páginas por sincronização atingido.");
      let result: GlpiPage | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await adapter.readPage(cursor, controller.signal);
          break;
        } catch (e) {
          if (
            adapter.mode === "real" ||
            controller.signal.aborted ||
            attempt === 2
          )
            throw e;
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }
      if (!result) throw Error("Falha na leitura da página.");
      consume(result.tickets);
      cursor = result.nextCursor;
      if (cursor) {
        if (visited.has(cursor))
          throw Error("Paginação repetida pelo adaptador.");
        visited.add(cursor);
      }
    } while (cursor);
  } finally {
    clearTimeout(timeout);
  }
}
/** Future signature providers must implement this; no provider is active in v1. */
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
