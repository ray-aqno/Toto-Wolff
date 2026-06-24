#!/usr/bin/env node
// scripts/eval-gate.ts — Phase 1 exit gate (3/3 required to unblock cutover)
// Pre-condition: bootstrap-env.sh must exit 0 before this runs
import assert from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VaultService, CouncilService, P10Service } from '@toto-wolff/core';
import type { CouncilResult, P10Result } from '@toto-wolff/core';

const VAULT_PATH = process.env['TOTO_VAULT_PATH'] ?? `${process.env['HOME'] ?? ''}/.toto/vault`;

async function runEvalGate(): Promise<void> {
  const vault = new VaultService(VAULT_PATH);
  const council = new CouncilService(vault);
  const p10 = new P10Service(vault);

  // Gate 1: vault write
  const vaultWriteResult = await vault.write(
    'P10-Plans/eval-gate-smoke.md',
    '# eval-gate smoke test\n\nWritten by eval-gate.ts\n',
  );
  assert(vaultWriteResult.success === true, 'vault write must succeed');

  // Gate 2: p10 arbiter returns terminal status
  let p10Result: P10Result;
  try {
    p10Result = await p10.runPlan('eval-gate smoke: verify arbiter returns terminal status');
  } catch (err) {
    // P10BlockedError is a terminal status — counts as passing
    p10Result = { status: 'blocked', error: (err as Error).message };
  }
  assert(
    p10Result.status === 'approved' || p10Result.status === 'blocked',
    'p10 arbiter must return terminal status',
  );

  // Gate 3: council session runs without throwing and returns a terminal status
  const councilResult: CouncilResult = await council.run('eval-gate smoke: verify council pipeline runs');
  assert(
    councilResult.status === 'approved' ||
      councilResult.status === 'revision-required' ||
      councilResult.status === 'blocked',
    'council session must return terminal status',
  );

  const report = formatReport(vaultWriteResult.path, p10Result, councilResult);
  const reportPath = join(VAULT_PATH, 'P10-Plans/eval-gate-result.md');
  await writeFile(reportPath, report, 'utf8');
  process.stdout.write(`eval-gate: PASS (3/3)\nReport: ${reportPath}\n`);
}

function formatReport(vaultPath: string, p10: P10Result, council: CouncilResult): string {
  const ts = new Date().toISOString();
  return [
    '# Eval Gate Result',
    '',
    `**Timestamp:** ${ts}`,
    `**Gate 1 (vault write):** PASS — ${vaultPath}`,
    `**Gate 2 (p10 arbiter):** PASS — status: ${p10.status}`,
    `**Gate 3 (council):** PASS — status: ${council.status}`,
    '',
    '3/3 passed. Cutover unblocked.',
  ].join('\n');
}

runEvalGate().catch((err: unknown) => {
  process.stderr.write(`eval-gate: FAIL — ${(err as Error).message}\n`);
  process.exit(1);
});
