#!/usr/bin/env node
/**
 * Fail-closed CI gate: the committed plugin/ folder must be exactly what
 * `pnpm sync:plugin` would produce from the current source.
 *
 * Rebuilds the bundle from clean (deleting dist/ and tsconfig.tsbuildinfo so
 * tsc cannot skip emitting), then fails on any of: a file outside the allowed
 * layout, a file over the directory's 1 MiB inspection limit, a missing or
 * double-bundled bundle, a skill copy that differs from its source in bytes
 * or exec bit, a missing or extra skill file, any symlink, or any modified,
 * deleted or untracked path under plugin/ versus the committed tree.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_REL,
  PLUGIN_DIR,
  REPO_ROOT,
  checkPluginLayout,
  checkSkillCopies,
  compareAgainstCommitted,
  readSkillList,
  rebuildBundle,
} from './plugin-sync-lib.js';

function main(): number {
  const skills = readSkillList(join(REPO_ROOT, PLUGIN_DIR, MANIFEST_REL));
  const rebuild = rebuildBundle(REPO_ROOT);
  if (!rebuild.ok) {
    console.error(`check-plugin-sync: ${rebuild.message}`);
    return 1;
  }
  const problems = [
    ...checkPluginLayout(join(REPO_ROOT, PLUGIN_DIR), skills),
    ...checkSkillCopies(REPO_ROOT, skills),
  ];
  const drift = compareAgainstCommitted(REPO_ROOT, PLUGIN_DIR);
  if (!drift.ok) problems.push(drift.message);
  if (problems.length > 0) {
    console.error(`check-plugin-sync:\n  ${problems.join('\n  ')}`);
    console.error('check-plugin-sync: run `pnpm sync:plugin` and commit the result.');
    return 1;
  }
  process.stdout.write(`check-plugin-sync: ${PLUGIN_DIR}/ matches a fresh rebuild (${String(skills.length)} skills + bundle).\n`);
  return 0;
}

// Guarded so importing this module (e.g. from a test) does not run the gate.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
