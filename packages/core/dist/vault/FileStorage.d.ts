/**
 * FileStorage — filesystem-backed storage backend for VaultService.
 * Uses the same write/search/commit logic as the original VaultService.
 */
import { StorageBackend, WriteResult, CommitResult, BackendStats, StorageConfig } from './StorageBackend.js';
export declare class FileStorage implements StorageBackend {
    readonly id = "file";
    readonly name = "Local Filesystem";
    private readonly rootPath;
    private readonly queue;
    private readonly queueMaxSize;
    constructor(config: StorageConfig);
    /** Create the vault's root directory if it doesn't already exist. */
    initialize(): Promise<void>;
    /** Write a file, queuing it for the next `commit()`. See queue notes below. */
    write(path: string, content: string): Promise<WriteResult>;
    /** Read a file's contents. Returns `null` if it does not exist. */
    read(path: string): Promise<string | null>;
    /** Check whether a file exists at `path`. */
    exists(path: string): Promise<boolean>;
    /** Recursively list files under the vault root matching `pattern` (glob-ish; all files if omitted), capped at `limit`. */
    list(pattern?: string, limit?: number): Promise<string[]>;
    /**
     * Lists file entries (not subdirectories) of a single directory,
     * non-recursively — matches the pre-VaultServiceV2 raw `readdir(dir)`
     * contract every call site was built against. `list()` above is a
     * recursive whole-vault walk and is NOT a substitute for this: a caller
     * that wants "immediate children of one directory" must use `listDir()`.
     */
    listDir(dir: string, limit?: number): Promise<string[]>;
    /**
     * Like `listDir()`, but with no cap — see the StorageBackend interface
     * doc for when this is (and isn't) the right choice over `listDir()`.
     */
    listDirAll(dir: string): Promise<string[]>;
    /** Delete a file. A no-op (not an error) if it doesn't exist. */
    delete(path: string): Promise<void>;
    /**
     * Drain the write queue: `git add` + `git commit` each queued path in
     * order, one commit per path. Stops at the first failure, leaving the
     * failed entry and everything behind it queued for the next call.
     * `{ committed: true }` immediately if nothing is queued. If the root
     * isn't a git repo, clears the queue (nothing to commit into) and returns
     * `{ committed: false, reason: 'no-git-repo' }`.
     */
    commit(message: string): Promise<CommitResult>;
    /** Recursively count files and total bytes under the vault root, plus the last git commit if the root is a git repo. */
    stats(): Promise<BackendStats>;
    /**
     * Discard any not-yet-committed queued writes. No persistent connections
     * to clean up for file storage, so this is the only actual cleanup work.
     */
    close(): Promise<void>;
    /** The absolute filesystem path this backend is rooted at. */
    getRootPath(): string;
    /**
     * Replaces any occurrence of the vault's absolute root path in an error
     * message with a placeholder, before it's surfaced to a caller — git's own
     * error text can carry `this.rootPath` verbatim (e.g. "fatal: not a git
     * repository: <rootPath>/.git"), which shouldn't leak the real filesystem
     * location into a commit-failure reason string.
     */
    private redactRootPath;
    private isGitRepo;
    private escapeRegExp;
    private matchGlob;
}
//# sourceMappingURL=FileStorage.d.ts.map