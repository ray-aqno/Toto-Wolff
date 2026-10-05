// The per-run lock: <run>/lock holds the holder's pid. It is written to
// lock.<pid>.tmp first and put in place with link(), which fails with EEXIST
// if a lock exists, so a lock is never visible empty (Arbiter condition 2).
// A lock is stale when its pid is ours (calls in one process never overlap,
// so it is a leftover) or no longer alive (ESRCH). An unreadable lock is
// never taken over. One OS pid namespace per project directory is assumed.
import assert from 'node:assert/strict';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { INTERNAL_ERROR, RpcError, isRecord } from '../mcp/protocol.mts';
import { GraphError } from './model.mts';

type Holder = { kind: 'none' } | { kind: 'unreadable' } | { kind: 'stale'; text: string } | { kind: 'live'; pid: number };

function errCode(err: unknown): string {
  return isRecord(err) && typeof err.code === 'string' ? err.code : '';
}

/** A positive safe integer pid, or null (0 and -1 would signal process groups). */
export function parsePid(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** Whether a pid names a live process: ESRCH means gone; EPERM means alive. */
export function isAlive(pid: number): boolean {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'only a positive pid is signalled');
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errCode(err) !== 'ESRCH';
  }
}

async function readHolder(lockFile: string): Promise<Holder> {
  assert.ok(lockFile.endsWith('lock'), 'the lock file');
  let text: string;
  try {
    text = await readFile(lockFile, 'utf8');
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { kind: 'none' };
    return { kind: 'unreadable' };
  }
  const pid = parsePid(text);
  if (pid === null) return { kind: 'unreadable' };
  if (pid === process.pid || !isAlive(pid)) return { kind: 'stale', text };
  return { kind: 'live', pid };
}

function busy(runId: string, holder: Holder): GraphError {
  assert.ok(holder.kind === 'live' || holder.kind === 'unreadable', 'only a held lock is busy');
  const who = holder.kind === 'live' ? `process ${String(holder.pid)}` : 'an unreadable lock file (remove it by hand if no session is running)';
  return new GraphError('RUN_BUSY', `run ${runId} is busy: held by ${who}`);
}

/**
 * graph_next's read-only check (Arbiter condition 5): RUN_BUSY when a live or
 * unreadable lock exists; a stale lock is ignored and left in place.
 */
export async function assertNotBusy(dir: string, runId: string): Promise<void> {
  const holder = await readHolder(join(dir, 'lock'));
  if (holder.kind === 'live' || holder.kind === 'unreadable') throw busy(runId, holder);
  assert.ok(holder.kind === 'none' || holder.kind === 'stale', 'the run is free');
}

// Removes a stale lock only if it still holds the same text (condition 4).
async function takeOver(lockFile: string, staleText: string): Promise<void> {
  assert.ok(staleText.length > 0, 'a stale lock has content');
  let now: string;
  try {
    now = await readFile(lockFile, 'utf8');
  } catch {
    return;
  }
  if (now === staleText) await unlink(lockFile).catch(() => undefined);
}

async function tryLink(tmp: string, lockFile: string): Promise<boolean> {
  try {
    await link(tmp, lockFile);
    return true;
  } catch (err) {
    if (errCode(err) === 'EEXIST') return false;
    // No hard links on this filesystem, or another fs error (Safety Car S1).
    throw new RpcError(INTERNAL_ERROR, `toto-wolff: cannot create the run lock ${lockFile} (${errCode(err) || String(err)}); the project directory needs a filesystem with hard links`);
  }
}

/** Takes the run's lock, taking over a stale one at most once; else RUN_BUSY. */
export async function acquireLock(dir: string, runId: string): Promise<void> {
  const lockFile = join(dir, 'lock');
  const tmp = join(dir, `lock.${String(process.pid)}.tmp`);
  // Overwritten, never exclusive: a leftover tmp from a killed process with a
  // reused pid must not block (Safety Car S2).
  await writeFile(tmp, `${String(process.pid)}\n`, 'utf8');
  try {
    // LOOP BOUND: two attempts (the first, then one after a stale takeover).
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await tryLink(tmp, lockFile)) return;
      const holder = await readHolder(lockFile);
      if (holder.kind === 'live' || holder.kind === 'unreadable') throw busy(runId, holder);
      if (holder.kind === 'stale') await takeOver(lockFile, holder.text);
    }
    throw new GraphError('RUN_BUSY', `run ${runId} is busy: another process took the lock`);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** Releases our lock; a failure is one stderr line (the next call recovers it as our own leftover). */
export async function releaseLock(dir: string): Promise<void> {
  const lockFile = join(dir, 'lock');
  assert.ok(dir.length > 0, 'a run directory');
  const holder = await readHolder(lockFile);
  // Only our own pid is removed: after the narrow double-takeover race the
  // lock may belong to another live process, which keeps it.
  const ours = holder.kind === 'stale' && parsePid(holder.text) === process.pid;
  assert.ok(!ours || holder.kind === 'stale', 'our pid reads as our own leftover');
  try {
    if (ours) await unlink(lockFile);
  } catch (err) {
    process.stderr.write(`toto-wolff: could not remove ${lockFile} (${errCode(err) || String(err)})\n`);
  }
}

/** Runs `fn` holding the run's lock. */
export async function withRunLock<T>(dir: string, runId: string, fn: () => Promise<T>): Promise<T> {
  await acquireLock(dir, runId);
  try {
    return await fn();
  } finally {
    await releaseLock(dir);
  }
}
