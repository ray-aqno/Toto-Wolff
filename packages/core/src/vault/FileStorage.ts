/**
 * FileStorage — filesystem-backed storage backend for VaultService.
 * Uses the same write/search/commit logic as the original VaultService.
 */

import { writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute, dirname, relative } from 'node:path';
import assert from 'node:assert';
import { StorageBackend, WriteResult, CommitResult, BackendStats, StorageConfig } from './StorageBackend.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_LIST_RESULTS = 1000;

export class FileStorage implements StorageBackend {
  readonly id = 'file';
  readonly name = 'Local Filesystem';

  private readonly rootPath: string;
  private readonly queue: string[] = [];
  private readonly queueMaxSize: number;

  constructor(config: StorageConfig) {
    assert(config.options.rootPath !== undefined, 'FileStorage requires options.rootPath');
    assert(isAbsolute(config.options.rootPath as string), 'rootPath must be absolute');
    this.rootPath = config.options.rootPath as string;
    this.queueMaxSize = (config.options.queueMaxSize as number) ?? 100;
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });
  }

  async write(path: string, content: string): Promise<WriteResult> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(typeof content === 'string' && content.length > 0, 'content must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');

    if (this.queue.length >= this.queueMaxSize) {
      throw new Error('queue full — drain backlogged');
    }
    this.queue.push(absPath);
    return { success: true, path: absPath };
  }

  async read(path: string): Promise<string | null> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    try {
      const { readFile } = await import('node:fs/promises');
      return await readFile(absPath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    try {
      await stat(absPath);
      return true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return false;
      throw err;
    }
  }

  async list(pattern?: string, limit?: number): Promise<string[]> {
    const maxResults = Math.min(limit ?? MAX_LIST_RESULTS, MAX_LIST_RESULTS);
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      // P10 Rule 2 — hard cap, see MAX_LIST_RESULTS
      if (results.length >= maxResults) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          const rel = relative(this.rootPath, fullPath);
          if (!pattern || this.matchGlob(rel, pattern)) {
            results.push(rel);
          }
        }
      }
    };

    await walk(this.rootPath);
    return results;
  }

  /**
   * Lists file entries (not subdirectories) of a single directory,
   * non-recursively — matches the pre-VaultServiceV2 raw `readdir(dir)`
   * contract every call site was built against. `list()` above is a
   * recursive whole-vault walk and is NOT a substitute for this: a caller
   * that wants "immediate children of one directory" must use `listDir()`.
   */
  async listDir(dir: string, limit?: number): Promise<string[]> {
    assert(typeof dir === 'string' && dir.length > 0, 'dir must be non-empty string');
    assert(!dir.includes('..'), 'dir must not contain ..');
    assert(!dir.startsWith('/'), 'dir must be relative');
    assert(!dir.includes('\0'), 'dir must not contain null bytes');

    const maxResults = Math.min(limit ?? MAX_LIST_RESULTS, MAX_LIST_RESULTS);
    const absDir = join(this.rootPath, dir);

    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return [];
      throw err;
    }

    const results: string[] = [];
    for (const entry of entries) {
      if (results.length >= maxResults) break; // P10 Rule 2 — hard cap, see MAX_LIST_RESULTS
      if (entry.isFile()) results.push(entry.name);
    }
    return results;
  }

  async delete(path: string): Promise<void> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    await rm(absPath, { force: true });
  }

  async commit(message: string): Promise<CommitResult> {
    // LOOP BOUND: max queueMaxSize iterations; queue guarded at enqueue time
    if (this.queue.length === 0) {
      return { committed: true };
    }

    if (!(await this.isGitRepo())) {
      this.queue.length = 0;
      return { committed: false, reason: 'no-git-repo' };
    }

    let committed = true;
    let reason: string | undefined;

    while (this.queue.length > 0) {
      const absPath = this.queue[0];
      assert(absPath !== undefined, 'queue entry must exist');
      const filename = absPath.split('/').pop() ?? 'file';
      const commitMsg = `${message} ${filename}`;
      try {
        await execFileAsync('git', ['-C', this.rootPath, 'add', absPath], { timeout: GIT_TIMEOUT_MS });
        await execFileAsync('git', ['-C', this.rootPath, 'commit', '-m', commitMsg], { timeout: GIT_TIMEOUT_MS });
      } catch (err) {
        committed = false;
        reason = `git commit failed: ${this.redactRootPath((err as Error).message)}`;
        break;
      }
      this.queue.shift();
    }

    return reason !== undefined ? { committed, reason } : { committed };
  }

  async stats(): Promise<BackendStats> {
    let fileCount = 0;
    let totalSizeBytes = 0;

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          fileCount++;
          const s = await stat(fullPath);
          totalSizeBytes += s.size;
        }
      }
    }

    await walk(this.rootPath);

    let lastCommit: string | undefined;
    if (await this.isGitRepo()) {
      try {
        const { stdout } = await execFileAsync('git', ['-C', this.rootPath, 'log', '-1', '--format=%H %s'], { timeout: GIT_TIMEOUT_MS });
        lastCommit = stdout.trim();
      } catch {
        // ignore
      }
    }

    const stats: BackendStats = { fileCount, totalSizeBytes };
    if (lastCommit !== undefined) stats.lastCommit = lastCommit;
    return stats;
  }

  close(): Promise<void> {
    // No persistent connections to clean up for file storage
    this.queue.length = 0;
    return Promise.resolve();
  }

  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * Replaces any occurrence of the vault's absolute root path in an error
   * message with a placeholder, before it's surfaced to a caller — git's own
   * error text can carry `this.rootPath` verbatim (e.g. "fatal: not a git
   * repository: <rootPath>/.git"), which shouldn't leak the real filesystem
   * location into a commit-failure reason string.
   */
  private redactRootPath(message: string): string {
    return message.split(this.rootPath).join('<vault>');
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync('git', ['-C', this.rootPath, 'rev-parse', '--git-dir'], { timeout: GIT_TIMEOUT_MS });
      return true;
    } catch (err) {
      const e = err as { code?: number | string; stderr?: string };
      if (e.code === 128 || /not a git repository/i.test(e.stderr ?? '')) {
        return false;
      }
      throw err;
    }
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private matchGlob(target: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      // Escape all regex metacharacters first (this also escapes '*' to
      // the literal sequence '\*'), THEN re-substitute that escaped
      // sequence back to the wildcard '.*'. Escaping after substitution
      // would re-escape the wildcard itself, breaking every real pattern.
      const escaped = this.escapeRegExp(pattern).replace(/\\\*/g, '.*');
      const regex = new RegExp('^' + escaped + '$');
      return regex.test(target);
    }
    return target === pattern || target.startsWith(pattern + '/');
  }
}