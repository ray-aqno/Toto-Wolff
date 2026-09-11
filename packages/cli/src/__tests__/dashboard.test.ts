import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDashboard } from '../commands/dashboard.js';

let capturedStdout = '';
let capturedStderr = '';
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalArgv = [...process.argv];

function captureOutput(): void {
  capturedStdout = '';
  capturedStderr = '';
  (process.stdout as NodeJS.WriteStream).write = (chunk: string): boolean => { capturedStdout += chunk; return true; };
  (process.stderr as NodeJS.WriteStream).write = (chunk: string): boolean => { capturedStderr += chunk; return true; };
}

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.argv = [...originalArgv];
  delete process.env['TOTO_VAULT_PATH'];
  delete process.env['VAULT_PATH'];
});

describe('runDashboard --terminal', () => {
  it('renders blocked council and P10 records when both are present', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-dash-'));
    try {
      await mkdir(join(vault, 'Council', 'Congressional-Records'), { recursive: true });
      await mkdir(join(vault, 'P10-Plans'), { recursive: true });
      await writeFile(join(vault, 'Council', 'Congressional-Records', '2026-01-01-council.md'), '---\nstatus: blocked\n---\nCouncil blocked reason.');
      await writeFile(join(vault, 'P10-Plans', '2026-01-02-plan.md'), '---\nstatus: blocked\n---\nP10 blocked reason.');

      process.env['TOTO_VAULT_PATH'] = vault;
      process.argv = [...originalArgv, '--terminal'];
      captureOutput();
      await runDashboard();

      expect(capturedStdout).toContain('council');
      expect(capturedStdout).toContain('Council blocked reason');
      expect(capturedStdout).toContain('p10');
      expect(capturedStdout).toContain('P10 blocked reason');
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it('renders "vault not found" when the vault directory does not exist', async () => {
    const vault = join(await mkdtemp(join(tmpdir(), 'toto-dash-')), 'does-not-exist');

    process.env['TOTO_VAULT_PATH'] = vault;
    process.argv = [...originalArgv, '--terminal'];
    captureOutput();
    await runDashboard();

    expect(capturedStdout).toContain('vault not found');
    expect(capturedStdout).toContain(vault);
  });

  it('renders "ALL CLEAR" when the vault exists but has no blocked items', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-dash-'));
    try {
      await mkdir(join(vault, 'Council', 'Congressional-Records'), { recursive: true });
      await writeFile(join(vault, 'Council', 'Congressional-Records', '2026-01-01-council.md'), '---\nstatus: approved\n---\nAll good.');

      process.env['TOTO_VAULT_PATH'] = vault;
      process.argv = [...originalArgv, '--terminal'];
      captureOutput();
      await runDashboard();

      expect(capturedStdout).toContain('ALL CLEAR');
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it('renders the readable session and surfaces an unreadable-file warning for a partially-corrupted directory', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'toto-dash-'));
    try {
      const councilDir = join(vault, 'Council', 'Congressional-Records');
      await mkdir(councilDir, { recursive: true });
      await writeFile(join(councilDir, '2026-01-01-good.md'), '---\nstatus: blocked\n---\nReadable blocked reason.');
      // A directory sharing the .md-looking name but which is itself a directory,
      // not a file — readFile() on it throws EISDIR, exercising the per-file
      // catch path without needing filesystem permission tricks.
      await mkdir(join(councilDir, '2026-01-02-bad.md'), { recursive: true });

      process.env['TOTO_VAULT_PATH'] = vault;
      process.argv = [...originalArgv, '--terminal'];
      captureOutput();
      await runDashboard();

      expect(capturedStdout).toContain('Readable blocked reason');
      expect(capturedStderr).toContain('could not be read');
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });
});
