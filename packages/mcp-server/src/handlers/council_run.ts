import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { CouncilService, CouncilResult } from '@toto-wolff/core';

interface CouncilRunInput {
  question: string;
}

function validateInput(raw: unknown): CouncilRunInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;
  if (typeof input['question'] !== 'string' || input['question'].length === 0) {
    throw new MCPValidationError('question must be non-empty string');
  }
  if (input['question'].length > 4000) {
    throw new MCPValidationError('question must not exceed 4000 chars');
  }
  return { question: input['question'] };
}

export async function handleCouncilRun(input: unknown, council: CouncilService): Promise<CouncilResult> {
  const { question } = validateInput(input);
  return council.run(question);
}
