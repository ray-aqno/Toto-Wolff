import type { IncomingMessage, ServerResponse } from "node:http";
/**
 * Scans VAULT_PATH/P10-Plans/ for plan files that cite the given verdict ID
 * in their session_verdicts frontmatter field. Returns all matching entries.
 * 200+[] on no matches (not an error). 500 only on readdir failure.
 */
export declare function handleVaultReversed(req: IncomingMessage, res: ServerResponse, vaultPath: string): Promise<void>;
//# sourceMappingURL=vault_reversed.d.ts.map