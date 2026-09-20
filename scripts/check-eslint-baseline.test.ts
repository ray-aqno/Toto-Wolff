import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  checkFloorInvariant,
  diffViolations,
  parseResults,
  runEslint,
  type Violation,
} from './check-eslint-baseline.js';

const v = (file: string, line: number, ruleId = 'no-console'): Violation => ({ file, line, ruleId });

describe('diffViolations', () => {
  it('reports what is new and what is gone, keyed on file, line and rule', () => {
    const baseline = [v('a.ts', 1), v('b.ts', 2)];
    const current = [v('a.ts', 1), v('c.ts', 3)];

    expect(diffViolations(current, baseline)).toEqual({
      newViolations: [v('c.ts', 3)],
      fixedOrBroken: [v('b.ts', 2)],
    });
  });

  it('treats the same violation on a shifted line as new (the documented brittleness)', () => {
    expect(diffViolations([v('a.ts', 2)], [v('a.ts', 1)]).newViolations).toEqual([v('a.ts', 2)]);
  });

  it('treats a different rule on the same line as new', () => {
    expect(diffViolations([v('a.ts', 1, 'no-undef')], [v('a.ts', 1)]).newViolations).toEqual([v('a.ts', 1, 'no-undef')]);
  });

  it('counts multiplicity: a further finding on an already-baselined line is new', () => {
    const baseline = [v('a.ts', 1), v('a.ts', 1)];

    expect(diffViolations([v('a.ts', 1), v('a.ts', 1), v('a.ts', 1)], baseline)).toEqual({
      newViolations: [v('a.ts', 1)],
      fixedOrBroken: [],
    });
  });

  it('counts a dropped duplicate as fixed, not as new', () => {
    expect(diffViolations([v('a.ts', 1)], [v('a.ts', 1), v('a.ts', 1)])).toEqual({
      newViolations: [],
      fixedOrBroken: [v('a.ts', 1)],
    });
  });

  it('reports nothing when the multiplicities match exactly', () => {
    const same = [v('a.ts', 1), v('a.ts', 1), v('b.ts', 2)];

    expect(diffViolations(same, same)).toEqual({ newViolations: [], fixedOrBroken: [] });
  });
});

describe('checkFloorInvariant', () => {
  it('skips the percentage check below the 20-entry absolute floor', () => {
    expect(checkFloorInvariant(19, 19)).toEqual({ ok: true });
  });

  it('passes when at most half of the baseline is gone', () => {
    expect(checkFloorInvariant(50, 100)).toEqual({ ok: true });
  });

  it('fails closed when more than half of the baseline is gone, naming both counts', () => {
    expect(checkFloorInvariant(51, 100)).toMatchObject({
      ok: false,
      message: expect.stringContaining('100 baseline entries but only 49 matched in this run'),
    });
  });
});

describe('parseResults', () => {
  it('flattens ESLint JSON into repo-relative {file, ruleId, line} entries', () => {
    const file = join(process.cwd(), 'packages', 'a.ts');
    const json = JSON.stringify([{ filePath: file, messages: [{ ruleId: 'no-console', line: 4 }, { ruleId: null, line: 9 }] }]);

    expect(parseResults(json)).toEqual([
      { file: join('packages', 'a.ts'), ruleId: 'no-console', line: 4 },
      { file: join('packages', 'a.ts'), ruleId: 'null', line: 9 },
    ]);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseResults('not json')).toThrow();
  });

  it.each([['{}'], ['null']])('throws when the output is not an array (%s)', (raw) => {
    expect(() => parseResults(raw)).toThrow('not a JSON array');
  });
});

describe('runEslint with a substituted process', () => {
  it('captures stdout and the exit status', () => {
    const result = runEslint('/bin/bash', ['-c', 'echo "[]"; exit 1']);

    expect(result).toMatchObject({ status: 1, spawnError: null });
    expect(result.stdout.trim()).toBe('[]');
  });

  it('passes an unexpected exit code through unchanged', () => {
    expect(runEslint('/bin/bash', ['-c', 'exit 42']).status).toBe(42);
  });

  it('reports a spawn error for a binary that does not exist', () => {
    const result = runEslint('/nonexistent/eslint', []);

    expect(result.spawnError).not.toBeNull();
    expect(result.status).toBeNull();
  });
});
