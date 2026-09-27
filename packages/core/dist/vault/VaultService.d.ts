/**
 * VaultService — unified vault interface with pluggable storage backends.
 * Delegates all operations to the active StorageBackend.
 * Supports hot-swapping backends at runtime via switchBackend().
 */
import { StorageBackend, BackendStats } from './StorageBackend.js';
import type { SearchResult, VaultWriteResult } from '../types.js';
export interface VaultConfig {
    backend: string;
    /** Backend-specific options (passed to backend constructor) */
    options: Record<string, unknown>;
    /** Optional: search command override (default: 'rg') */
    searchCommand?: string;
    /** Optional: search timeout in ms (default: 5000) */
    searchTimeoutMs?: number;
}
export declare class VaultService {
    private backend;
    private readonly config;
    private lock;
    /**
     * Set once close() has actually released this service's reference.
     * Without it, a second close() call would release a second reference it
     * was never granted — fatal for a backend shared with other VaultService
     * instances, since it can evict the backend while they still use it.
     */
    private closed;
    private constructor();
    /**
     * Queue an operation onto the shared serialization chain. Every public
     * method that touches `this.backend` runs through here so no operation
     * can execute against a backend reference a later-queued switchBackend()
     * has already closed. The chain-advancement continuation swallows
     * rejections so one failed operation doesn't jam the queue for everyone
     * queued after it — the caller still sees the real result/rejection via
     * `result`.
     */
    private enqueue;
    /**
     * Throws if this service has already been closed. After the last owner
     * releases a shared backend, VaultFactory may evict and close it — a
     * closed-but-still-called service must not go on reading, writing, or
     * committing through that reference (a later, unrelated create() for the
     * same vault would then get a fresh backend with its own queue, and the
     * two could race against the same git working tree). Called from inside
     * each enqueued operation, not before enqueueing, so it sees `closed` as
     * of when the operation actually runs — correct even if a queued close()
     * ahead of it hasn't executed yet at call time.
     */
    private assertOpen;
    /**
     * Release this service's reference to its current backend, using the
     * config that acquired it — NOT `this.backend.close()` directly. Backends
     * obtained through VaultFactory.create() are config-keyed and may be
     * shared by other VaultService instances against the same vault; only
     * VaultFactory itself knows when the last reference has gone and it's
     * actually safe to close. Called before `this.backend`/`this.config` are
     * reassigned to the new backend, so it always releases the outgoing one.
     */
    private releaseBackend;
    /** Create a VaultService with the specified backend. */
    static create(config: VaultConfig): Promise<VaultService>;
    /** Switch to a different backend at runtime (hot-swap). */
    switchBackend(config: VaultConfig): Promise<void>;
    /**
     * Get the currently active backend.
     *
     * Deliberate escape hatch, NOT routed through the serialization queue:
     * callers needing direct backend access get a synchronous reference.
     * Do not hold this reference or use it across an `await` boundary — a
     * concurrent switchBackend() can close it out from under you. This is a
     * known, accepted gap, not an oversight.
     */
    getBackend(): StorageBackend;
    /** Get the current backend ID. */
    getBackendId(): string;
    /**
     * Read a file from the vault. Returns `null` if the path does not exist —
     * callers must check `=== null`, not catch ENOENT.
     */
    read(path: string): Promise<string | null>;
    /** Check whether a file exists in the vault. */
    exists(path: string): Promise<boolean>;
    /** List files matching a pattern (or all if pattern is undefined), capped at `limit`. */
    list(pattern?: string, limit?: number): Promise<string[]>;
    /**
     * List file entries (not subdirectories) of a single directory,
     * non-recursively — capped at `limit`. Use this, not `list()`, for a
     * "readdir this one directory" need; `list()` walks the whole vault.
     */
    listDir(dir: string, limit?: number): Promise<string[]>;
    /** Like `listDir()`, but uncapped. See StorageBackend.listDirAll(). */
    listDirAll(dir: string): Promise<string[]>;
    /** Write a file to the vault. */
    write(relPath: string, content: string): Promise<VaultWriteResult>;
    /** Search the vault using ripgrep (or backend-specific search). */
    search(query: string): Promise<SearchResult[]>;
    private searchLocked;
    private searchWithRg;
    /** Drain the commit queue (for git-backed backends). */
    drainQueue(): Promise<void>;
    /** Get backend statistics. */
    stats(): Promise<BackendStats>;
    /**
     * Close the vault and release this service's reference to its backend.
     * Idempotent — a second call is a no-op, since this service already gave
     * up its one reference on the first call and holds no claim to release
     * again (releasing twice would evict a backend still in use by whichever
     * other VaultService instances share it). The terminal `closed` state is
     * only set once release actually succeeds — if it rejects (a pluggable
     * backend's close() can fail), this service is NOT marked closed, so a
     * caller can call close() again to retry the cleanup instead of every
     * later call silently no-op'ing over a cleanup that never happened.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=VaultService.d.ts.map