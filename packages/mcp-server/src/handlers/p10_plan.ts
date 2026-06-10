import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import { P10BlockedError } from '@toto-wolff/core';
import type { P10Service, P10Result } from '@toto-wolff/core';

interface P10PlanInput {
  task: string;
}

function validateInput(raw: unknown): P10PlanInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;
  if (typeof input['task'] !== 'string' || input['task'].length === 0) {
    throw new MCPValidationError('task must be non-empty string');
  }
  if (input['task'].length > 4000) {
    throw new MCPValidationError('task must not exceed 4000 chars');
  }
  return { task: input['task'] };
}

export async function handleP10Plan(input: unknown, p10: P10Service): Promise<P10Result> {
  const { task } = validateInput(input);
  try {
    return await p10.runPlan(task);
  } catch (err) {
    // A blocked ruling is a governance outcome, not a server fault. Return a
    // clean blocked result (HTTP 200) instead of leaking the vault path through
    // the generic 500 handler. Full detail goes to stderr for server-side trace.
    if (err instanceof P10BlockedError) {
      // Observability without leaking the vault path into server logs — the
      // blocked plan is already persisted in the vault for inspection.
      process.stderr.write('p10_plan: arbiter returned blocked\n');
      return { status: 'blocked' };
    }
    throw err;
  }
}
