import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const PATTERNS_JSON = resolve(REPO_ROOT, '.toto', 'sensitive-patterns.json');
const CLAUDE_MD = resolve(REPO_ROOT, 'CLAUDE.md');

/**
 * Reads the canonical pattern list from .toto/sensitive-patterns.json.
 * P10-R2 LOOP BOUND: no internal loop; returns array of length ≤ 20.
 */
function readJsonPatterns(patternsPath: string): string[] {
  // R5 assertion 1: file exists
  if (!existsSync(patternsPath)) {
    console.error(`check-patterns: ${patternsPath} not found — run toto init`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(patternsPath, 'utf8'));
  } catch (err) {
    console.error(`check-patterns: failed to parse ${patternsPath} — ${String(err)}`);
    process.exit(1);
  }
  // R5 assertion 2: correct shape
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj['patterns'])) {
    console.error(`check-patterns: ${patternsPath} missing .patterns array`);
    process.exit(1);
  }
  return obj['patterns'] as string[];
}

/**
 * Reads the pattern list from the ##sensitive-patterns fenced block in CLAUDE.md.
 * P10-R2 LOOP BOUND: one pass over file lines (bounded by file size, typ. <1000 lines).
 */
function readClaudeMdPatterns(claudePath: string): string[] {
  // R5 assertion 1: file exists
  if (!existsSync(claudePath)) {
    console.error(`check-patterns: ${claudePath} not found`);
    process.exit(1);
  }
  let raw: string;
  try {
    raw = readFileSync(claudePath, 'utf8');
  } catch (err) {
    console.error(`check-patterns: failed to read ${claudePath} — ${String(err)}`);
    process.exit(1);
  }
  const lines = raw.split('\n');
  let fenceStart = -1;
  let fenceEnd = -1;
  for (let i = 0; i < lines.length; i++) { // P10-R2: bounded by lines.length
    if (lines[i] === '```sensitive-patterns') { fenceStart = i; }
    else if (fenceStart !== -1 && lines[i] === '```') { fenceEnd = i; break; }
  }
  // R5 assertion 2: fence found
  if (fenceStart === -1 || fenceEnd === -1) {
    console.error('check-patterns: CLAUDE.md missing ```sensitive-patterns``` fenced block');
    process.exit(1);
  }
  return lines
    .slice(fenceStart + 1, fenceEnd)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Rejects patterns broad enough to match arbitrary diff content (e.g. ".*", "").
 * Defense-in-depth: the pre-commit hook trusts this list without re-validating.
 * P10-R2 LOOP BOUND: no internal loop; called once per pattern, ≤ 20 total.
 */
function isDangerousPattern(pattern: string): boolean {
  if (pattern.trim().length === 0) return true;
  if (/^\.\*+$/.test(pattern)) return true;
  if (/^\.\+$/.test(pattern)) return true;
  return false;
}

/**
 * Returns patterns present in one list but not the other.
 * P10-R2 LOOP BOUND: two passes of length ≤ 20 each.
 */
function diffPatterns(jsonPatterns: string[], mdPatterns: string[]): { missing: string[]; extra: string[] } {
  const jsonSet = new Set(jsonPatterns);
  const mdSet = new Set(mdPatterns);
  const missing = jsonPatterns.filter((p) => !mdSet.has(p)); // in JSON, not in CLAUDE.md
  const extra = mdPatterns.filter((p) => !jsonSet.has(p));   // in CLAUDE.md, not in JSON
  return { missing, extra };
}

function main(): void {
  const jsonPatterns = readJsonPatterns(PATTERNS_JSON);

  const dangerous = jsonPatterns.filter(isDangerousPattern); // P10-R2: bounded by jsonPatterns.length ≤ 20
  if (dangerous.length > 0) {
    console.error(`check-patterns: .toto/sensitive-patterns.json contains overbroad pattern(s): ${dangerous.join(', ')}`);
    console.error('Fix: patterns must not match arbitrary content (no bare ".*", ".+", or empty strings).');
    process.exit(1);
  }

  const mdPatterns = readClaudeMdPatterns(CLAUDE_MD);
  const { missing, extra } = diffPatterns(jsonPatterns, mdPatterns);

  if (missing.length > 0 || extra.length > 0) {
    console.error('check-patterns: CLAUDE.md sensitive-patterns fence is out of sync with .toto/sensitive-patterns.json');
    if (missing.length > 0) console.error(`  In JSON but missing from CLAUDE.md: ${missing.join(', ')}`);
    if (extra.length > 0)   console.error(`  In CLAUDE.md but missing from JSON: ${extra.join(', ')}`);
    console.error('Fix: update both .toto/sensitive-patterns.json and the CLAUDE.md fence to match.');
    process.exit(1);
  }

  console.log(`check-patterns: OK (${jsonPatterns.length} patterns in sync)`);
  process.exit(0);
}

main();
