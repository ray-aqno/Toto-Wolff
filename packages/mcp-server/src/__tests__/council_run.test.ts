import { describe, expect, it } from 'vitest';
import { handleCouncilRun } from '../handlers/council_run.js';
import { MCPValidationError } from '../handlers/vault_write.js';
import type { CouncilResult, CouncilService, SignalRecord } from '@toto-wolff/core';

describe('handleCouncilRun', () => {
  it('passes currentTags and priors through to CouncilService.run', async () => {
    const result: CouncilResult = {
      status: 'approved',
      ruling: 'ok',
      brief: 'ok',
      recordPath: 'Council/Congressional-Records/1-council.md',
    };

    const council = {
      run: async (_question: string, currentTags: string[] = [], priors: SignalRecord[] = []) => {
        expect(currentTags).toEqual(['auth']);
        expect(priors).toHaveLength(1);
        expect(priors[0]?.id).toBe('prior-1');
        return result;
      },
    } as unknown as CouncilService;

    const input = {
      question: 'Which approach should we choose?',
      currentTags: ['auth'],
      priors: [{
        id: 'prior-1',
        content_hash: 'abc',
        valid_until: '2099-01-01',
        verdict: 'blocked',
        topic_tags: ['auth'],
      }],
    };

    await expect(handleCouncilRun(input, council)).resolves.toEqual(result);
  });

  it('rejects non-string currentTags values', async () => {
    const council = { run: async () => ({ status: 'approved', ruling: 'ok', brief: 'ok', recordPath: 'x' }) } as unknown as CouncilService;

    await expect(handleCouncilRun({ question: 'Why?', currentTags: ['auth', 42] as unknown as string[] }, council))
      .rejects.toThrow(MCPValidationError);
  });
});
