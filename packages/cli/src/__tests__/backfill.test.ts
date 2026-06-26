import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBackfill } from '../commands/backfill.js';

function makeAdr(status: string, tags: string): string {
  return `---\nstatus: ${status}\ndate: 2026-06-01\ntags: ${tags}\n---\n# ADR\n\nBody.`;
}

let capturedStdout = '';
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  capturedStdout = '';
  (process.stdout as NodeJS.WriteStream).write = (chunk: string) => { capturedStdout += chunk; return true; };
});

afterEach(() => {
  process.stdout.write = originalWrite;
  delete process.env['TOTO_VAULT_PATH'];
  delete process.env['VAULT_PATH'];
});

describe('runBackfill', () => {
  it('maps accepted→approved and writes signal with pattern + topic_tags', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-bf-'));
    try {
      await mkdir(join(vault, 'ADR'), { recursive: true });
      await writeFile(join(vault, 'ADR', 'adr-auth.md'), makeAdr('accepted', '[auth, boundary]'));

      process.env['TOTO_VAULT_PATH'] = vault;
      await runBackfill();

      expect(capturedStdout).toContain('written=1');
      expect(capturedStdout).toContain('adr-auth');

      const { readFile } = await import('node:fs/promises');
      const signal = await readFile(join(vault, 'Signals', 'adr-auth.md'), 'utf8');
      expect(signal).toContain('verdict: "approved"');
      expect(signal).toContain('pattern: "architectural-decision-record"');
      expect(signal).toContain('topic_tags:');
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it('skips re-writing an existing signal on second run (idempotent)', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-bf-'));
    try {
      await mkdir(join(vault, 'ADR'), { recursive: true });
      await writeFile(join(vault, 'ADR', 'adr-auth.md'), makeAdr('accepted', '[auth]'));

      process.env['TOTO_VAULT_PATH'] = vault;
      await runBackfill();

      capturedStdout = '';
      await runBackfill();

      expect(capturedStdout).toContain('written=0');
      expect(capturedStdout).toContain('skipped=1');

      const signals = await readdir(join(vault, 'Signals'));
      expect(signals.filter(f => f.endsWith('.md'))).toHaveLength(1);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it('reads TOTO_VAULT_PATH ahead of VAULT_PATH', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-bf-'));
    const wrong = await mkdtemp(join(tmpdir(), 'toto-wrong-'));
    try {
      await mkdir(join(vault, 'ADR'), { recursive: true });
      await writeFile(join(vault, 'ADR', 'adr-env.md'), makeAdr('approved', '[env]'));

      process.env['TOTO_VAULT_PATH'] = vault;
      process.env['VAULT_PATH'] = wrong;
      await runBackfill();

      expect(capturedStdout).toContain('written=1');

      const correctSignals = await readdir(join(vault, 'Signals')).catch(() => []);
      expect(correctSignals.some(f => f.includes('adr-env'))).toBe(true);

      const wrongSignals = await readdir(join(wrong, 'Signals')).catch(() => []);
      expect(wrongSignals).toHaveLength(0);
    } finally {
      await rm(vault, { recursive: true, force: true });
      await rm(wrong, { recursive: true, force: true });
    }
  });
});
