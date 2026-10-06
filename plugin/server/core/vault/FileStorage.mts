/**
 * FileStorage: filesystem-backed storage backend for VaultService.
 * Uses the same write/search/commit logic as the original VaultService.
 */

import { writeFile, mkdir, readdir, readFile, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { GIT_IDENTITY, childEnv } from '../childEnv.mts';
import { promisify } from 'node:util';
import { join, isAbsolute, dirname, relative } from 'node:path';
import assert from 'node:assert';
import type { StorageBackend, WriteResult, CommitResult, BackendStats, StorageConfig } from './StorageBackend.mts';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_LIST_RESULTS = 1000;
/** Deepest directory level the walks descend to (P10 Rule 2). */
const MAX_WALK_DEPTH = 16;
/** stats() counts at most this many files (P10 Rule 2); larger vaults undercount. */
const MAX_STATS_FILES = 10_000;

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

  /** Create the vault's root directory if it doesn't already exist. */
  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });
  }

  /** Write a file, queuing it for the next `commit()`. See queue notes below. */
  async write(path: string, content: string): Promise<WriteResult> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(typeof content === 'string' && content.length > 0, 'content must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    // Checked before writing: a full-queue rejection must never leave the
    // file changed on disk with no record of that change ever queued.
    if (this.queue.length >= this.queueMaxSize) {
      throw new Error('queue full: drain backlogged');
    }

    const absPath = join(this.rootPath, path);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');

    // Deduplicated: `git add` + `git commit` at drain time always picks up
    // whatever content is currently on disk for a path, so a second entry
    // for the same path can never commit anything beyond what the first
    // entry's commit already captured: it can only fail as an empty commit
    // and wedge the queue at that entry forever (nothing after it drains).
    if (!this.queue.includes(absPath)) {
      this.queue.push(absPath);
    }
    return { success: true, path: absPath };
  }

  /** Read a file's contents. Returns `null` if it does not exist. */
  async read(path: string): Promise<string | null> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    try {
      return await readFile(absPath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Check whether a file exists at `path`. */
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

  /** List files under the vault root matching `pattern` (glob-ish; all files if omitted), capped at `limit`. Iterative walk. */
  async list(pattern?: string, limit?: number): Promise<string[]> {
    const maxResults = Math.min(limit ?? MAX_LIST_RESULTS, MAX_LIST_RESULTS);
    const results: string[] = [];
    const stack: { dir: string; depth: number }[] = [{ dir: this.rootPath, depth: 0 }];
    // P10 Rule 2: bounded by maxResults files and MAX_WALK_DEPTH levels.
    while (stack.length > 0 && results.length < maxResults) {
      const current = stack.pop();
      assert(current !== undefined, 'walk stack underflow');
      const entries = await readdir(current.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_WALK_DEPTH) stack.push({ dir: fullPath, depth: current.depth + 1 });
        } else {
          const rel = relative(this.rootPath, fullPath);
          if (!pattern || this.matchGlob(rel, pattern)) results.push(rel);
        }
      }
    }
    assert(results.length <= maxResults, 'list respects its cap');
    return results;
  }

  /**
   * Lists file entries (not subdirectories) of a single directory,
   * non-recursively: matches the pre-VaultServiceV2 raw `readdir(dir)`
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
      if (results.length >= maxResults) break; // P10 Rule 2: hard cap, see MAX_LIST_RESULTS
      if (entry.isFile()) results.push(entry.name);
    }
    return results;
  }

  /**
   * Like `listDir()`, but with no cap: see the StorageBackend interface
   * doc for when this is (and isn't) the right choice over `listDir()`.
   */
  async listDirAll(dir: string): Promise<string[]> {
    assert(typeof dir === 'string' && dir.length > 0, 'dir must be non-empty string');
    assert(!dir.includes('..'), 'dir must not contain ..');
    assert(!dir.startsWith('/'), 'dir must be relative');
    assert(!dir.includes('\0'), 'dir must not contain null bytes');

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
      if (entry.isFile()) results.push(entry.name);
    }
    return results;
  }

  /** Delete a file. A no-op (not an error) if it doesn't exist. */
  async delete(path: string): Promise<void> {
    assert(typeof path === 'string' && path.length > 0, 'path must be non-empty string');
    assert(!path.includes('..'), 'path must not contain ..');
    assert(!path.startsWith('/'), 'path must be relative');
    assert(!path.includes('\0'), 'path must not contain null bytes');

    const absPath = join(this.rootPath, path);
    await rm(absPath, { force: true });
  }

  /**
   * Drain the write queue: `git add` + `git commit` each queued path in
   * order, one commit per path. Commits are best effort: at the first
   * failure the queue is cleared (the files are already on disk) and one
   * warning goes to stderr, so a failing git never wedges later writes.
   * `{ committed: true }` immediately if nothing is queued. If the root
   * isn't a git repo, clears the queue (nothing to commit into) and returns
   * `{ committed: false, reason: 'no-git-repo' }`.
   */
  async commit(message: string): Promise<CommitResult> {
    // LOOP BOUND: max queueMaxSize iterations; queue guarded at enqueue time
    if (this.queue.length === 0) {
      return { committed: true };
    }

    let isRepo: boolean;
    try {
      isRepo = await this.isGitRepo();
    } catch (err) {
      // git itself failed (timeout, broken install): best effort, as for a
      // failed commit below, so the queue never fills and rejects writes.
      const reason = `git check failed: ${this.redactRootPath((err as Error).message)}`;
      process.stderr.write(`toto-wolff: vault commit skipped (${String(this.queue.length)} queued file(s) kept on disk, uncommitted): ${reason}\n`);
      this.queue.length = 0;
      return { committed: false, reason };
    }
    if (!isRepo) {
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
        await execFileAsync('git', ['-C', this.rootPath, 'add', absPath], { timeout: GIT_TIMEOUT_MS, env: childEnv() });
        await execFileAsync('git', [...GIT_IDENTITY, '-C', this.rootPath, 'commit', '-m', commitMsg], { timeout: GIT_TIMEOUT_MS, env: childEnv() });
      } catch (err) {
        committed = false;
        reason = `git commit failed: ${this.redactRootPath((err as Error).message)}`;
        process.stderr.write(`toto-wolff: vault commit skipped (${String(this.queue.length)} queued file(s) kept on disk, uncommitted): ${reason}\n`);
        this.queue.length = 0;
        break;
      }
      this.queue.shift();
    }

    return reason !== undefined ? { committed, reason } : { committed };
  }

  /** Count files and total bytes under the vault root (iterative, capped at MAX_STATS_FILES), plus the last git commit if the root is a git repo. */
  async stats(): Promise<BackendStats> {
    let fileCount = 0;
    let totalSizeBytes = 0;
    const stack: { dir: string; depth: number }[] = [{ dir: this.rootPath, depth: 0 }];
    // P10 Rule 2: bounded by MAX_STATS_FILES files and MAX_WALK_DEPTH levels.
    while (stack.length > 0 && fileCount < MAX_STATS_FILES) {
      const current = stack.pop();
      assert(current !== undefined, 'walk stack underflow');
      const entries = await readdir(current.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (fileCount >= MAX_STATS_FILES) break;
        const fullPath = join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_WALK_DEPTH) stack.push({ dir: fullPath, depth: current.depth + 1 });
        } else {
          fileCount++;
          totalSizeBytes += (await stat(fullPath)).size;
        }
      }
    }
    assert(fileCount <= MAX_STATS_FILES, 'stats respects its cap');

    let lastCommit: string | undefined;
    if (await this.isGitRepo()) {
      try {
        const { stdout } = await execFileAsync('git', ['-C', this.rootPath, 'log', '-1', '--format=%H %s'], { timeout: GIT_TIMEOUT_MS, env: childEnv() });
        lastCommit = stdout.trim();
      } catch {
        // ignore
      }
    }

    const stats: BackendStats = { fileCount, totalSizeBytes };
    if (lastCommit !== undefined) stats.lastCommit = lastCommit;
    return stats;
  }

  /**
   * Discard any not-yet-committed queued writes. No persistent connections
   * to clean up for file storage, so this is the only actual cleanup work.
   */
  close(): Promise<void> {
    this.queue.length = 0;
    return Promise.resolve();
  }

  /** The absolute filesystem path this backend is rooted at. */
  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * Replaces any occurrence of the vault's absolute root path in an error
   * message with a placeholder, before it's surfaced to a caller: git's own
   * error text can carry `this.rootPath` verbatim (e.g. "fatal: not a git
   * repository: <rootPath>/.git"), which shouldn't leak the real filesystem
   * location into a commit-failure reason string.
   */
  private redactRootPath(message: string): string {
    return message.split(this.rootPath).join('<vault>');
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync('git', ['-C', this.rootPath, 'rev-parse', '--git-dir'], { timeout: GIT_TIMEOUT_MS, env: childEnv() });
      return true;
    } catch (err) {
      const e = err as { code?: number | string; stderr?: string };
      // ENOENT: no git binary at all, which counts as "not a repo" (git is optional).
      if (e.code === 128 || e.code === 'ENOENT' || /not a git repository/i.test(e.stderr ?? '')) {
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