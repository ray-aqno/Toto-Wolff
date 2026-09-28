#!/usr/bin/env node
/**
 * Rebuilds packages/core/dist and packages/mcp-server/dist from current
 * source and stages the result with git, so a developer (or the release
 * process) can commit an up-to-date build in one step. Mirrors
 * generate-eslint-baseline.ts's role for that gate: this script produces the
 * committable artifact, check-dist-sync.ts verifies it.
 *
 * Does not commit - staging only, so the resulting diff can be reviewed
 * before it becomes part of a commit.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES, REPO_ROOT, runRebuild } from './check-dist-sync.js';

function main(): void {
  const rebuild = runRebuild();
  if (!rebuild.ok) {
    console.error(`sync-dist: ${rebuild.message}`);
    process.exit(1);
  }

  const paths = PACKAGES.map((pkg) => join('packages', pkg, 'dist'));
  const add = spawnSync('git', ['add', ...paths], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (add.error || add.status !== 0) {
    console.error(`sync-dist: git add failed for ${paths.join(', ')}: ${add.error?.message ?? `exit ${String(add.status)}`}`);
    process.exit(1);
  }

  console.log(`sync-dist: rebuilt and staged ${paths.join(', ')} - review the diff, then commit.`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
