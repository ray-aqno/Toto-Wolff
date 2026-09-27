import type { SearchResult, VaultWriteResult } from './types.js';
export declare class VaultService {
    private readonly vaultPath;
    private readonly queue;
    constructor(vaultPath: string);
    write(relPath: string, content: string): Promise<VaultWriteResult>;
    search(query: string): Promise<SearchResult[]>;
    drainQueue(): Promise<void>;
    private commitFile;
    private isGitRepo;
}
//# sourceMappingURL=VaultService.d.ts.map