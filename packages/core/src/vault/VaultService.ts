/**
 * VaultService — unified vault interface with pluggable storage backends.
 * Delegates all operations to the active StorageBackend.
 * Supports hot-swapping backends at runtime via switchBackend().
 */

import assert from 'node:assert';
import { StorageBackend, BackendStats } from './StorageBackend.js';
import { VaultFactory } from './VaultFactory.js';
import { VaultSearchError } from '../types.js';
import type { SearchResult, VaultWriteResult } from '../types.js';
import type { ExecFileException } from 'node:child_process';

const MAX_LIST_RESULTS = 1000;

export interface VaultConfig {
  backend: string;
  /** Backend-specific options (passed to backend constructor) */
  options: Record<string, unknown>;
  /** Optional: search command override (default: 'rg') */
  searchCommand?: string;
  /** Optional: search timeout in ms (default: 5000) */
  searchTimeoutMs?: number;
}

export class VaultService {
  private backend: StorageBackend;
  private readonly config: VaultConfig;
  private lock: Promise<unknown> = Promise.resolve();

  private constructor(config: VaultConfig, backend: StorageBackend) {
    this.config = config;
    this.backend = backend;
  }

  /**
   * Queue an operation onto the shared serialization chain. Every public
   * method that touches `this.backend` runs through here so no operation
   * can execute against a backend reference a later-queued switchBackend()
   * has already closed. The chain-advancement continuation swallows
   * rejections so one failed operation doesn't jam the queue for everyone
   * queued after it — the caller still sees the real result/rejection via
   * `result`.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.lock.then(op);
    this.lock = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Create a VaultService with the specified backend. */
  static async create(config: VaultConfig): Promise<VaultService> {
    const backend = VaultFactory.create(config.backend, {
      id: config.backend,
      name: config.backend,
      options: config.options,
    });

    if (!backend) {
      throw new Error(`Unknown backend: ${config.backend}`);
    }

    await backend.initialize();
    return new VaultService(config, backend);
  }

  /** Switch to a different backend at runtime (hot-swap). */
  async switchBackend(config: VaultConfig): Promise<void> {
    return this.enqueue(async () => {
      // Drain pending commits from current backend before switching
      const commitFn = this.backend.commit?.bind(this.backend);
      if (commitFn) {
        await commitFn('vault: pre-switch drain');
      }

      const newBackend = VaultFactory.create(config.backend, {
        id: config.backend,
        name: config.backend,
        options: config.options,
      });

      if (!newBackend) {
        throw new Error(`Unknown backend: ${config.backend}`);
      }

      await newBackend.initialize();

      // Close old backend
      await this.backend.close();

      this.backend = newBackend;
      Object.assign(this.config, config);
    });
  }

  /**
   * Get the currently active backend.
   *
   * Deliberate escape hatch, NOT routed through the serialization queue:
   * callers needing direct backend access get a synchronous reference.
   * Do not hold this reference or use it across an `await` boundary — a
   * concurrent switchBackend() can close it out from under you. This is a
   * known, accepted gap, not an oversight.
   */
  getBackend(): StorageBackend {
    return this.backend;
  }

  /** Get the current backend ID. */
  getBackendId(): string {
    return this.backend.id;
  }

  /**
   * Read a file from the vault. Returns `null` if the path does not exist —
   * callers must check `=== null`, not catch ENOENT.
   */
  async read(path: string): Promise<string | null> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    return this.enqueue(() => this.backend.read(path));
  }

  /** Check whether a file exists in the vault. */
  async exists(path: string): Promise<boolean> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    return this.enqueue(() => this.backend.exists(path));
  }

  /** List files matching a pattern (or all if pattern is undefined), capped at `limit`. */
  async list(pattern?: string, limit = MAX_LIST_RESULTS): Promise<string[]> {
    assert(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer');
    return this.enqueue(() => this.backend.list(pattern, limit));
  }

  /**
   * List file entries (not subdirectories) of a single directory,
   * non-recursively — capped at `limit`. Use this, not `list()`, for a
   * "readdir this one directory" need; `list()` walks the whole vault.
   */
  async listDir(dir: string, limit = MAX_LIST_RESULTS): Promise<string[]> {
    assert(typeof dir === 'string' && dir.length > 0, 'dir must be non-empty string');
    assert(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer');
    return this.enqueue(() => this.backend.listDir(dir, limit));
  }

  /** Write a file to the vault. */
  async write(relPath: string, content: string): Promise<VaultWriteResult> {
    assert(typeof relPath === 'string' && relPath.length > 0, 'relPath must be non-empty string');
    return this.enqueue(async () => {
      const result = await this.backend.write(relPath, content);
      return {
        success: result.success,
        path: result.path,
      };
    });
  }

  /** Search the vault using ripgrep (or backend-specific search). */
  async search(query: string): Promise<SearchResult[]> {
    return this.enqueue(() => this.searchLocked(query));
  }

  private async searchLocked(query: string): Promise<SearchResult[]> {
    const timeoutMs = this.config.searchTimeoutMs ?? RG_TIMEOUT_MS;

    if (this.config.searchCommand === undefined && this.backend.id === 'file') {
      // Use the original rg-based search for file backend
      return this.searchWithRg(query, timeoutMs);
    }

    // Fallback: list all files and search in-memory (for non-file backends)
    const files = await this.backend.list();
    const results: SearchResult[] = [];

    for (const file of files) {
      const content = await this.backend.read(file);
      if (!content) continue;
      if (!content.includes(query)) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && line.includes(query)) {
          results.push({
            file,
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }
    return results;
  }

  private async searchWithRg(query: string, timeoutMs: number): Promise<SearchResult[]> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // We need the root path - extract from backend if it's FileStorage
    const rootPath = this.backend.getRootPath?.();
    if (!rootPath) {
      throw new VaultSearchError('Cannot determine vault root path for rg search');
    }

    try {
      const { stdout } = await execFileAsync(
        'rg', ['--json', query, rootPath],
        { timeout: timeoutMs },
      );
      return parseRgOutput(stdout);
    } catch (err) {
      const code = (err as ExecFileException).code;
      if (code === 1) return [];
      throw new VaultSearchError(`rg failed with code ${String(code)}`);
    }
  }

  /** Drain the commit queue (for git-backed backends). */
  async drainQueue(): Promise<void> {
    return this.enqueue(async () => {
      const commitFn = this.backend.commit?.bind(this.backend);
      if (commitFn) {
        await commitFn('vault: drain');
      }
    });
  }

  /** Get backend statistics. */
  async stats(): Promise<BackendStats> {
    return this.enqueue(async () => {
      const statsFn = this.backend.stats?.bind(this.backend);
      return statsFn ? await statsFn() : { fileCount: 0, totalSizeBytes: 0 };
    });
  }

  /** Close the vault and clean up resources. */
  async close(): Promise<void> {
    return this.enqueue(() => this.backend.close());
  }
}

const RG_TIMEOUT_MS = 5_000;

function parseRgOutput(stdout: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as {
        type: string;
        data?: { path?: { text: string }; line_number?: number; lines?: { text: string } };
      };
      if (parsed.type === 'match' && parsed.data !== undefined) {
        results.push({
          file: parsed.data.path?.text ?? '',
          line: parsed.data.line_number ?? 0,
          text: parsed.data.lines?.text.trim() ?? '',
        });
      }
    } catch {
      // skip malformed rg output lines
    }
  }
  return results;
}