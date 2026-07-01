import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { detectReversal } from '@toto-wolff/core';
import { handleCouncilRun, extractQuestionTags } from '../handlers/council_run.js';
import { MCPValidationError } from '../handlers/vault_write.js';
import type { CouncilResult, CouncilService, SignalRecord } from '@toto-wolff/core';

describe('handleCouncilRun', () => {
  it('passes explicit currentTags and priors through to CouncilService.run untouched', async () => {
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

    await expect(handleCouncilRun(input, council, '/unused/when/priors/supplied')).resolves.toEqual(result);
  });

  it('rejects non-string currentTags values', async () => {
    const council = { run: async () => ({ status: 'approved', ruling: 'ok', brief: 'ok', recordPath: 'x' }) } as unknown as CouncilService;

    await expect(handleCouncilRun({ question: 'Why?', currentTags: ['auth', 42] as unknown as string[] }, council, '/unused'))
      .rejects.toThrow(MCPValidationError);
  });

  describe('T5 end-to-end: real SignalIndex prior-loading through the real handler', () => {
    let vaultPath: string;

    afterEach(async () => {
      if (vaultPath) await rm(vaultPath, { recursive: true, force: true });
    });

    it('loads a real prior from the vault and detectReversal fires true on a conflicting verdict', async () => {
      vaultPath = await mkdtemp(join(tmpdir(), 'toto-vault-'));
      const signalsDir = join(vaultPath, 'Signals');
      await mkdir(signalsDir, { recursive: true });
      await writeFile(
        join(signalsDir, 'prior-migration.md'),
        [
          '---',
          'id: prior-migration-1',
          'content_hash: abc123',
          'valid_until: 2099-01-01',
          'verdict: blocked',
          'topic_tags: ["migration", "auth"]',
          '---',
          '',
          'Prior ruling: migration approach blocked due to auth coupling.',
        ].join('\n'),
      );

      let capturedTags: string[] = [];
      let capturedPriors: SignalRecord[] = [];

      const council = {
        run: async (_question: string, currentTags: string[] = [], priors: SignalRecord[] = []) => {
          capturedTags = currentTags;
          capturedPriors = priors;
          // Real end-to-end assertion: the actual detectReversal function, fed the
          // priors this handler loaded from disk, fires true against a conflicting
          // current verdict — the exact branch Feynman found unreachable.
          const reversal = detectReversal('approved', currentTags, priors);
          return {
            status: 'approved' as const,
            ruling: 'ok',
            brief: 'ok',
            recordPath: 'Council/Congressional-Records/2-council.md',
            reversalDetected: reversal !== null,
            priorId: reversal?.priorId,
          };
        },
      } as unknown as CouncilService;

      const result = await handleCouncilRun(
        { question: 'Which approach should the migration take for auth?' },
        council,
        vaultPath,
      );

      expect(capturedPriors).toHaveLength(1);
      expect(capturedPriors[0]?.id).toBe('prior-migration-1');
      expect(capturedTags).toEqual(expect.arrayContaining(['migration', 'auth', 'approach']));
      expect(result.reversalDetected).toBe(true);
      expect(result.priorId).toBe('prior-migration-1');
    });

    it('returns no reversal when the vault has no Signals directory (cold start)', async () => {
      vaultPath = await mkdtemp(join(tmpdir(), 'toto-vault-empty-'));

      const council = {
        run: async (_question: string, currentTags: string[] = [], priors: SignalRecord[] = []) => {
          const reversal = detectReversal('approved', currentTags, priors);
          return {
            status: 'approved' as const,
            ruling: 'ok',
            brief: 'ok',
            recordPath: 'x',
            reversalDetected: reversal !== null,
          };
        },
      } as unknown as CouncilService;

      const result = await handleCouncilRun({ question: 'Which pattern did we use for reversal detection?' }, council, vaultPath);

      expect(result.reversalDetected).toBe(false);
    });
  });

  describe('extractQuestionTags', () => {
    it('derives lowercase, deduped, length-filtered tags capped at 8', () => {
      const tags = extractQuestionTags('Which approach should the team take for the auth migration rollout strategy plan design');
      expect(tags.length).toBeLessThanOrEqual(8);
      expect(tags).toContain('migration');
      expect(tags.every((t) => t === t.toLowerCase())).toBe(true);
    });
  });
});
