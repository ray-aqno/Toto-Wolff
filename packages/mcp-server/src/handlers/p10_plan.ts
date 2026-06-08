import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
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
  return p10.runPlan(task);
}
