import type { VaultService } from '@toto-wolff/core';
export declare class MCPValidationError extends Error {
    constructor(message: string);
}
export declare function handleVaultWrite(input: unknown, vault: VaultService): Promise<{
    path: string;
}>;
//# sourceMappingURL=vault_write.d.ts.map