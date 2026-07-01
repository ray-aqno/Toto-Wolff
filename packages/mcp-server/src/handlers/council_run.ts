import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { CouncilService, CouncilResult, SignalRecord } from '@toto-wolff/core';

interface CouncilRunInput {
  question: string;
  currentTags?: string[];
  priors?: SignalRecord[];
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

  const rawCurrentTags = input['currentTags'];
  if (rawCurrentTags !== undefined) {
    if (!Array.isArray(rawCurrentTags) || rawCurrentTags.some((tag) => typeof tag !== 'string')) {
      throw new MCPValidationError('currentTags must be an array of strings when provided');
    }
  }

  const rawPriors = input['priors'];
  if (rawPriors !== undefined) {
    if (!Array.isArray(rawPriors)) {
      throw new MCPValidationError('priors must be an array when provided');
    }
  }

  return {
    question: input['question'],
    ...(rawCurrentTags !== undefined ? { currentTags: rawCurrentTags as string[] } : {}),
    ...(rawPriors !== undefined ? { priors: rawPriors as SignalRecord[] } : {}),
  };
}

export async function handleCouncilRun(input: unknown, council: CouncilService): Promise<CouncilResult> {
  const { question, currentTags, priors } = validateInput(input);
  return council.run(question, currentTags ?? [], priors ?? []);
}
