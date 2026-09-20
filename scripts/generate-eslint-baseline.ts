#!/usr/bin/env node
/**
 * Generates/regenerates `.eslint-baseline.json` from the current live
 * ESLint run. Reuses check-eslint-baseline.ts's own runEslint()/
 * parseResults() so the baseline and the gate always agree on shape.
 *
 * Per this plan's Decision Overview: a regenerated baseline must NEVER be
 * committed by simply re-running this script and taking its output: a
 * human reviewer must inspect the diff of added/removed entries first and
 * confirm no real violations were papered over. See CONTRIBUTING.md.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPackagesBuilt, runEslint, parseResults, type Violation } from './check-eslint-baseline.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = join(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, '.eslint-baseline.json');

function sortKey(v: Violation): string {
  return `${v.file}:${String(v.line).padStart(6, '0')}:${v.ruleId}`;
}

function main(): void {
  assertPackagesBuilt();
  const { stdout, status, spawnError } = runEslint();
  if (spawnError) {
    console.error(`could not spawn eslint: ${spawnError.message}`);
    process.exit(1);
  }
  if (status !== 0 && status !== 1) {
    console.error(`eslint exited with unexpected code ${String(status)}`);
    process.exit(1);
  }

  const violations = parseResults(stdout).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  writeFileSync(BASELINE_PATH, JSON.stringify(violations, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${violations.length} entries to ${BASELINE_PATH}`);
}

main();
