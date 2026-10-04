#!/usr/bin/env node
/**
 * Regenerates the plugin/ folder's skill copies and stages plugin/ with git:
 * copies every skill the plugin manifest lists from .claude/skills/, then
 * checks the result the same way check-plugin-sync.ts does. The server under
 * plugin/server/ is source, not generated, so it is checked but never
 * rewritten. Does not commit, so the diff can be reviewed.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_REL,
  PLUGIN_DIR,
  REPO_ROOT,
  checkPluginLayout,
  checkSkillCopies,
  readSkillList,
  syncSkills,
} from './plugin-sync-lib.js';

function main(): number {
  const skills = readSkillList(join(REPO_ROOT, PLUGIN_DIR, MANIFEST_REL));
  syncSkills(REPO_ROOT, skills);
  const problems = [
    ...checkPluginLayout(join(REPO_ROOT, PLUGIN_DIR), skills),
    ...checkSkillCopies(REPO_ROOT, skills),
  ];
  if (problems.length > 0) {
    console.error(`sync-plugin: the regenerated plugin folder is not valid:\n  ${problems.join('\n  ')}`);
    return 1;
  }
  const add = spawnSync('git', ['add', '--', PLUGIN_DIR], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (add.error || add.status !== 0) {
    console.error(`sync-plugin: git add ${PLUGIN_DIR} failed: ${add.error?.message ?? `exit ${String(add.status)}`}`);
    return 1;
  }
  process.stdout.write(`sync-plugin: synced and staged ${PLUGIN_DIR}/ (${String(skills.length)} skills + server); review the diff, then commit.\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
