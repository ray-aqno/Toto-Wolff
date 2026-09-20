#!/usr/bin/env node
/**
 * ESLint baseline-diff CI gate.
 *
 * Fails closed on any new ESLint violation not already in the committed
 * `.eslint-baseline.json`, while tolerating the pre-existing baselined
 * violations (a known, tracked cleanup backlog, not something this gate
 * re-litigates). Mirrors the `.gitleaks-baseline.json` pattern already used
 * by this repo's `secret-scan` CI job.
 *
 * Floor-invariant check: a run that parses cleanly but reports suspiciously
 * few violations relative to the baseline is NOT evidence the codebase got
 * cleaner; it is equally consistent with a broken CI environment (wrong
 * cwd, `packages/` renamed, a silently-empty ESLint config, over-broad
 * ignore patterns). That failure mode is more dangerous than a crash,
 * because it produces a plausible-looking success. So this script computes
 * `fixedOrBroken` (baseline entries with no matching current entry) and
 * fails closed if it exceeds 50% of the baseline's total entry count: no
 * single PR plausibly fixes over half of the pre-existing violations in one
 * run, so crossing that line is a much stronger signal of "the run didn't
 * execute correctly" than of "someone did a heroic cleanup." Below a small
 * absolute floor of 20 baseline entries, this percentage check is skipped
 * entirely: at small baseline sizes a percentage is too noisy to tell a
 * broken run apart from a legitimate cleanup PR (e.g. at 10 entries, fixing
 * 6 in one PR is completely ordinary but would trip a bare 50% rule).
 *
 * Baseline regeneration procedure: a regenerated `.eslint-baseline.json`
 * must never be committed by simply re-running the generator and taking its
 * output: a human reviewer must inspect the diff of added/removed entries
 * and confirm no real violations were papered over. This is a process
 * requirement, not something this script can enforce mechanically (see
 * CONTRIBUTING.md's PR checklist).
 *
 * Build first (`pnpm build`): the type-aware lint rules need the packages'
 * built declarations, so both this gate and the generator refuse to run on an
 * unbuilt tree rather than report or baseline hundreds of spurious violations.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = join(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, '.eslint-baseline.json');

export interface Violation {
  file: string;
  ruleId: string;
  line: number;
}

interface EslintMessage {
  ruleId: string | null;
  line: number;
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

function violationKey(v: Violation): string {
  return `${v.file}:${v.line}:${v.ruleId}`;
}

const DEFAULT_ESLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');
const DEFAULT_ESLINT_ARGS = ['packages', '-f', 'json'];
/** Ceiling on ESLint's captured JSON output; the whole-repo report is large and spawnSync would otherwise cut it off. */
const ESLINT_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;
const BUILT_MARKER = join(REPO_ROOT, 'packages', 'core', 'dist', 'index.d.ts');

/**
 * Exits 1 with a clear message when the packages are unbuilt. The type-aware
 * lint rules need built declarations; an unbuilt tree reports about 300 more
 * no-unsafe-* violations than a built one, which would fail every PR or be
 * baselined by mistake.
 */
export function assertPackagesBuilt(): void {
  if (!existsSync(BUILT_MARKER)) {
    console.error('packages are not built (missing packages/core/dist/index.d.ts); run `pnpm build` first; failing closed');
    process.exit(1);
  }
}

/**
 * Runs the eslint binary against `packages`, capturing stdout and exit code
 * explicitly, never a bare truthy/falsy check. `cmd`/`args` are overridable
 * (default to the local node_modules/.bin/eslint) so a test can substitute a
 * fake process: a nonexistent path (spawn failure), or `/bin/bash -c
 * '<script>'` (corrupted output, near-empty results), to exercise each
 * fail-closed path deterministically, without mutating the real PATH or an
 * on-disk fixture's permissions.
 */
export function runEslint(
  cmd: string = DEFAULT_ESLINT_BIN,
  args: string[] = DEFAULT_ESLINT_ARGS,
): { stdout: string; status: number | null; spawnError: Error | null } {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: ESLINT_OUTPUT_MAX_BYTES,
  });
  return { stdout: result.stdout ?? '', status: result.status, spawnError: result.error ?? null };
}

/** Parses ESLint's JSON output into the baseline's flat {file, ruleId, line} shape. Throws on malformed input; caller must catch. */
export function parseResults(json: string): Violation[] {
  const parsed = JSON.parse(json) as EslintResult[];
  if (!Array.isArray(parsed)) {
    throw new Error('eslint output was not a JSON array');
  }
  const violations: Violation[] = [];
  for (const result of parsed) {
    const file = relative(REPO_ROOT, result.filePath);
    for (const message of result.messages) {
      violations.push({ file, ruleId: String(message.ruleId), line: message.line });
    }
  }
  return violations;
}

/** Pure diff: returns violations present now but absent from the baseline (`new`), and vice versa (`fixedOrBroken`). */
export function diffViolations(
  current: Violation[],
  baseline: Violation[],
): { newViolations: Violation[]; fixedOrBroken: Violation[] } {
  const currentKeys = new Set(current.map(violationKey));
  const baselineKeys = new Set(baseline.map(violationKey));
  const newViolations = current.filter((v) => !baselineKeys.has(violationKey(v)));
  const fixedOrBroken = baseline.filter((v) => !currentKeys.has(violationKey(v)));
  return { newViolations, fixedOrBroken };
}

/** Below this many baseline entries the percentage check is skipped: too noisy to tell a broken run from a cleanup. */
const FLOOR_INVARIANT_ABSOLUTE_MINIMUM = 20;
/** More than this fraction of the baseline vanishing in one run is treated as a broken run, not a cleanup. */
const FLOOR_INVARIANT_MAX_FIXED_FRACTION = 0.5;

/** Pure: decides whether the fixedOrBroken count is suspicious relative to baseline size, and names both counts in the message. */
export function checkFloorInvariant(
  fixedOrBrokenCount: number,
  baselineTotal: number,
): { ok: true } | { ok: false; message: string } {
  if (baselineTotal < FLOOR_INVARIANT_ABSOLUTE_MINIMUM) {
    return { ok: true };
  }
  if (fixedOrBrokenCount > baselineTotal * FLOOR_INVARIANT_MAX_FIXED_FRACTION) {
    return {
      ok: false,
      message:
        `${baselineTotal} baseline entries but only ${baselineTotal - fixedOrBrokenCount} matched in this run; ` +
        `likely a broken run (wrong cwd, missing config, everything ignored), not a clean codebase; refusing to silently pass.`,
    };
  }
  return { ok: true };
}

function loadBaseline(): Violation[] {
  const raw = readFileSync(BASELINE_PATH, 'utf-8');
  return JSON.parse(raw) as Violation[];
}

function main(): void {
  // Overridable via env vars so CI-gate failure modes can be exercised
  // deterministically in tests without mutating the real PATH or a
  // fixture's on-disk permissions.
  const overrideCmd = process.env['ESLINT_BASELINE_CMD'];
  const overrideArgs = process.env['ESLINT_BASELINE_ARGS'];
  if (!(overrideCmd && overrideArgs)) {
    assertPackagesBuilt();
  }
  const { stdout, status, spawnError } =
    overrideCmd && overrideArgs
      ? runEslint(overrideCmd, JSON.parse(overrideArgs) as string[])
      : runEslint();

  if (spawnError) {
    console.error(`could not spawn eslint; failing closed (${spawnError.message})`);
    process.exit(1);
  }

  if (status !== 0 && status !== 1) {
    console.error(`eslint exited with unexpected code ${String(status)}; failing closed`);
    process.exit(1);
  }

  let current: Violation[];
  try {
    current = parseResults(stdout);
  } catch (err) {
    console.error(`could not parse eslint output; failing closed (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }

  const baseline = loadBaseline();
  const { newViolations, fixedOrBroken } = diffViolations(current, baseline);

  const floorCheck = checkFloorInvariant(fixedOrBroken.length, baseline.length);
  if (!floorCheck.ok) {
    console.error(floorCheck.message);
    process.exit(1);
  }

  if (newViolations.length > 0) {
    console.error(`${newViolations.length} new ESLint violation(s) not present in .eslint-baseline.json:`);
    for (const v of newViolations) {
      console.error(`  ${v.file}:${v.line} ${v.ruleId}`);
    }
    process.exit(1);
  }

  console.log(`lint-baseline: clean (${current.length} current violations, all baselined; ${fixedOrBroken.length} baseline entries no longer present)`);
  process.exit(0);
}

// Guarded so importing this module (e.g. from a test) doesn't also run the
// CI gate for real as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
