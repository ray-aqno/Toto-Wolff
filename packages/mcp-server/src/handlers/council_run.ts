import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import { SignalIndex } from './signal_index.js';
import type { CouncilService, CouncilResult, SignalRecord } from '@toto-wolff/core';

interface CouncilRunInput {
  question: string;
  currentTags?: string[];
  priors?: SignalRecord[];
}

const MAX_TAGS = 8;
const MIN_TAG_LENGTH = 3;
// Generic question scaffolding — excluded so jaccard similarity reflects topic
// overlap, not shared sentence structure between unrelated questions.
const STOPWORDS = new Set([
  'which', 'what', 'should', 'the', 'for', 'and', 'take', 'with', 'that',
  'this', 'have', 'does', 'were', 'been', 'from', 'into', 'about', 'would',
  'could', 'when', 'where', 'how', 'did', 'was', 'are', 'you', 'our', 'team',
]);

/**
 * Derives coarse topic tags from a question when the caller doesn't supply
 * currentTags explicitly — this is what makes T5 reversal detection reachable
 * from a real council_run call instead of only from hand-supplied test tags.
 */
export function extractQuestionTags(question: string): string[] {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > MIN_TAG_LENGTH && !STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, MAX_TAGS);
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

export async function handleCouncilRun(input: unknown, council: CouncilService, vaultPath: string): Promise<CouncilResult> {
  const { question, currentTags, priors } = validateInput(input);

  if (priors !== undefined) {
    return council.run(question, currentTags ?? [], priors);
  }

  // No caller-supplied priors — load real ones from the vault so T5 reversal
  // detection is reachable through the actual MCP call path, not just tests.
  const signalIndex = new SignalIndex(vaultPath);
  await signalIndex.load();
  const loadedPriors = signalIndex.getAll();
  const tags = currentTags ?? extractQuestionTags(question);

  return council.run(question, tags, loadedPriors);
}
