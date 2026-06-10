import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute, dirname } from 'node:path';
import assert from 'node:assert';
import type { ExecFileException } from 'node:child_process';
import { VaultCommitError, VaultSearchError } from './types.js';
import type { SearchResult, VaultWriteResult } from './types.js';

const execFileAsync = promisify(execFile);
const QUEUE_MAX_SIZE = 100;
const GIT_TIMEOUT_MS = 10_000;
const RG_TIMEOUT_MS = 5_000;

export class VaultService {
  private readonly vaultPath: string;
  private readonly queue: string[] = [];

  constructor(vaultPath: string) {
    assert(isAbsolute(vaultPath), 'vaultPath must be absolute');
    this.vaultPath = vaultPath;
  }

  async write(relPath: string, content: string): Promise<VaultWriteResult> {
    assert(typeof relPath === 'string' && relPath.length > 0, 'relPath must be non-empty string');
    assert(typeof content === 'string' && content.length > 0, 'content must be non-empty string');
    // CSO: path traversal + null byte injection prevention
    assert(!relPath.includes('..'), 'relPath must not contain ..');
    assert(!relPath.startsWith('/'), 'relPath must be relative');
    assert(!relPath.includes('\0'), 'relPath must not contain null bytes');

    const absPath = join(this.vaultPath, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');

    if (this.queue.length >= QUEUE_MAX_SIZE) {
      throw new VaultCommitError('queue full — drain backlogged');
    }
    this.queue.push(absPath);
    return { success: true, path: absPath };
  }

  async search(query: string): Promise<SearchResult[]> {
    assert(typeof query === 'string' && query.length > 0, 'query must be non-empty string');
    assert(query.length <= 500, 'query must not exceed 500 chars');

    try {
      const { stdout } = await execFileAsync(
        'rg', ['--json', query, this.vaultPath],
        { timeout: RG_TIMEOUT_MS },
      );
      return parseRgOutput(stdout);
    } catch (err) {
      // rg exit 1 = no results; exit >= 2 = real error
      const code = (err as ExecFileException).code;
      if (code === 1) return [];
      throw new VaultSearchError(`rg failed with code ${String(code)}`);
    }
  }

  async drainQueue(): Promise<void> {
    // LOOP BOUND: max QUEUE_MAX_SIZE (=100) iterations; queue guarded at enqueue time
    while (this.queue.length > 0) {
      const absPath = this.queue[0];
      assert(absPath !== undefined, 'queue entry must exist');
      const filename = absPath.split('/').pop() ?? 'file';
      const commit = await this.commitFile(absPath, `vault: write ${filename}`);
      if (!commit.committed) {
        process.stderr.write(`vault: commit skipped (${commit.reason ?? 'unknown'}) for ${filename}\n`);
      }
      this.queue.shift();
    }
  }

  private async commitFile(absPath: string, message: string): Promise<{ committed: boolean; reason?: string }> {
    assert(isAbsolute(absPath), 'absPath must be absolute');
    // CSO: null byte would escape execFile argv boundary
    assert(!absPath.includes('\0'), 'absPath must not contain null bytes');

    // git is the audit trail, not the source of truth — a vault without .git
    // still persists writes. Skip the commit observably rather than crash.
    if (!(await this.isGitRepo())) {
      return { committed: false, reason: 'no-git-repo' };
    }
    try {
      await execFileAsync('git', ['-C', this.vaultPath, 'add', absPath], { timeout: GIT_TIMEOUT_MS });
      await execFileAsync('git', ['-C', this.vaultPath, 'commit', '-m', message], { timeout: GIT_TIMEOUT_MS });
      return { committed: true };
    } catch (err) {
      // CSO: do not expose internal paths in error message
      throw new VaultCommitError(`git commit failed: ${(err as Error).message}`);
    }
  }

  private async isGitRepo(): Promise<boolean> {
    assert(this.vaultPath.length > 0, 'vaultPath must be non-empty');
    try {
      await execFileAsync('git', ['-C', this.vaultPath, 'rev-parse', '--git-dir'], { timeout: GIT_TIMEOUT_MS });
      return true;
    } catch (err) {
      // git exits 128 with "not a git repository" when the vault has no repo —
      // the only case we treat as "skip the commit". Anything else (git missing,
      // timeout, permission denied) is a real failure and must surface, not be
      // masked as no-git-repo.
      const e = err as { code?: number | string; stderr?: string };
      if (e.code === 128 || /not a git repository/i.test(e.stderr ?? '')) {
        return false;
      }
      throw err;
    }
  }
}

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
