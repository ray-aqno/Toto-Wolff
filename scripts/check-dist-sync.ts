#!/usr/bin/env node
/**
 * Fail-closed CI gate: confirms the committed `packages/core/dist/` and
 * `packages/mcp-server/dist/` actually match what a fresh rebuild of the
 * committed source produces.
 *
 * The plugin now launches `node packages/mcp-server/dist/index.js` directly
 * against these committed trees, with no build step at install time. That
 * only stays true if the committed output really is what the source
 * currently produces - this gate is the thing that makes that claim checked
 * rather than assumed.
 *
 * The comparison is `git status --porcelain --untracked-files=all` against a
 * freshly-rebuilt-in-place tree, not `git diff --exit-code`: `git diff` only
 * reports on content git already tracks, so it silently misses two real
 * drift cases - a new emitted file whose source was added but never
 * committed (shows up as untracked, which `git diff` ignores), and a stale
 * committed file whose source was deleted (nothing about the file itself
 * changed, so `git diff` sees no difference while the plugin ships dead
 * code). `git status --porcelain --untracked-files=all` catches both.
 *
 * Every rebuild deletes `dist/` and the package's local `tsconfig.tsbuildinfo`
 * first. `tsbuildinfo` lives at the package root, not inside `dist/`, and is
 * never itself committed - but tsc's incremental engine can still use a local,
 * uncommitted tsbuildinfo (left over from any earlier build on the same
 * machine) to decide nothing changed and skip emitting new output entirely,
 * which would make this gate compare a stale rebuild against itself and pass
 * regardless of real drift. Deleting it forces a genuinely fresh compile.
 *
 * The delete step refuses to run unless the resolved path literally ends in
 * `packages/<pkg>/dist`, derived from this script's own file location - never
 * from an environment variable or CLI argument, so a wrong working directory
 * or an injected input can't redirect it elsewhere. It does not follow
 * symlinks: a symlinked dist/ is refused, not recursed through.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
export const REPO_ROOT = join(__dirname, '..');

export const PACKAGES = ['core', 'mcp-server'] as const;
export type PackageName = (typeof PACKAGES)[number];

function distPath(pkg: PackageName, repoRoot: string = REPO_ROOT): string {
  return join(repoRoot, 'packages', pkg, 'dist');
}

function tsbuildinfoPath(pkg: PackageName): string {
  return join(REPO_ROOT, 'packages', pkg, 'tsconfig.tsbuildinfo');
}

/**
 * Refuses to return a path unless it resolves to exactly `packages/<pkg>/dist`
 * under `repoRoot` (this script's own repo root by default - never an
 * externally-settable input in the real callers below), and refuses if that
 * path exists and is a symlink. Throws rather than deletes anything itself -
 * callers delete only the path this returns. `repoRoot` is overridable so a
 * test can point this at a disposable fixture and observe the real refusal
 * logic, not just assert the fixture's own shape.
 */
export function assertSafeDistPath(pkg: PackageName, repoRoot: string = REPO_ROOT): string {
  const expectedSuffix = join('packages', pkg, 'dist');
  const p = distPath(pkg, repoRoot);
  if (!p.endsWith(expectedSuffix)) {
    throw new Error(`refusing to touch ${p}: does not resolve to ${expectedSuffix} under the repo root`);
  }
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) {
    throw new Error(`refusing to touch ${p}: it is a symlink, not a real directory`);
  }
  return p;
}

/** Fails if a package's dist/ is missing, or git has zero tracked paths under it - distinct, named failure from "out of sync". */
export function assertDistCommitted(pkg: PackageName): { ok: true } | { ok: false; message: string } {
  const p = distPath(pkg);
  if (!existsSync(p)) {
    return { ok: false, message: `packages/${pkg}/dist does not exist - the initial commit may have been reverted or never ran` };
  }
  const result = spawnSync('git', ['ls-files', '--', `packages/${pkg}/dist`], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (result.error) {
    return { ok: false, message: `could not run git ls-files for packages/${pkg}/dist: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { ok: false, message: `git ls-files exited ${String(result.status)} for packages/${pkg}/dist` };
  }
  const tracked = result.stdout.trim().split('\n').filter((line) => line.length > 0);
  if (tracked.length === 0) {
    return { ok: false, message: `packages/${pkg}/dist has zero git-tracked files - the initial commit may have been reverted or never ran` };
  }
  return { ok: true };
}

/**
 * Deletes a package's dist/ and local tsbuildinfo, then rebuilds it.
 * Core must build before mcp-server: mcp-server's build is `tsc -p` (not
 * `tsc -b`), so it does not build its own project-reference dependencies -
 * it needs core's already-emitted .d.ts output to exist first.
 */
export function rebuildPackage(pkg: PackageName): { ok: true } | { ok: false; message: string } {
  const dist = assertSafeDistPath(pkg);
  const tsbuildinfo = tsbuildinfoPath(pkg);

  if (existsSync(dist)) {
    rmSync(dist, { recursive: true, force: true });
  }
  if (existsSync(tsbuildinfo)) {
    rmSync(tsbuildinfo, { force: true });
  }

  const result = spawnSync('pnpm', ['-C', `packages/${pkg}`, 'build'], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (result.error) {
    return { ok: false, message: `could not spawn build for packages/${pkg}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: `build failed for packages/${pkg} (exit ${String(result.status)}):\n${result.stderr}`,
    };
  }

  if (!existsSync(dist) || readdirSync(dist).length === 0) {
    return { ok: false, message: `packages/${pkg}/dist is missing or empty after a supposedly successful build - a silent no-op build must not pass` };
  }
  const leftoverTsbuildinfo = readdirSync(dist).filter((name) => name.endsWith('.tsbuildinfo'));
  if (leftoverTsbuildinfo.length > 0) {
    return { ok: false, message: `packages/${pkg}/dist contains a .tsbuildinfo file after rebuild (${leftoverTsbuildinfo.join(', ')}) - this should never happen given tsbuildinfo's confirmed package-root location` };
  }
  return { ok: true };
}

export function runRebuild(): { ok: true } | { ok: false; message: string } {
  for (const pkg of PACKAGES) {
    const result = rebuildPackage(pkg);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

/**
 * The real pass/fail signal: any tracked-modified, tracked-deleted, or
 * untracked-new path under packages/<pkg>/dist means out of sync. A
 * non-zero exit or spawn error is ambiguous and fails closed - never
 * silently treated as "must be fine".
 */
export function compareAgainstCommitted(pkg: PackageName): { inSync: true } | { inSync: false; message: string } {
  const relDist = join('packages', pkg, 'dist');
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', relDist], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  if (status.error) {
    return { inSync: false, message: `could not run git status for ${relDist}: ${status.error.message} - ambiguous, failing closed` };
  }
  if (status.status !== 0) {
    return { inSync: false, message: `git status exited ${String(status.status)} for ${relDist} - ambiguous, failing closed` };
  }
  const changes = status.stdout.trim();
  if (changes.length === 0) {
    return { inSync: true };
  }
  let humanDiff = '';
  try {
    humanDiff = execFileSync('git', ['diff', '--stat', '--', relDist], { cwd: REPO_ROOT, encoding: 'utf-8' });
  } catch {
    // Best-effort only - the porcelain status above is the actual signal.
  }
  return {
    inSync: false,
    message: `${relDist} is out of sync with a fresh rebuild:\n${changes}\n${humanDiff}`.trim(),
  };
}

function main(): void {
  for (const pkg of PACKAGES) {
    const committed = assertDistCommitted(pkg);
    if (!committed.ok) {
      console.error(`check-dist-sync: ${committed.message}`);
      process.exit(1);
    }
  }

  const rebuild = runRebuild();
  if (!rebuild.ok) {
    console.error(`check-dist-sync: ${rebuild.message}`);
    process.exit(1);
  }

  let anyOutOfSync = false;
  for (const pkg of PACKAGES) {
    const comparison = compareAgainstCommitted(pkg);
    if (!comparison.inSync) {
      console.error(`check-dist-sync: ${comparison.message}`);
      anyOutOfSync = true;
    }
  }
  if (anyOutOfSync) {
    console.error('check-dist-sync: run `pnpm sync:dist` and commit the result.');
    process.exit(1);
  }

  console.log('check-dist-sync: packages/core/dist and packages/mcp-server/dist both match a fresh rebuild.');
  process.exit(0);
}

// Guarded so importing this module (e.g. from a test) doesn't also run the
// CI gate for real as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
