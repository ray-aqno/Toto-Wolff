import { describe, it, expect, vi, afterEach } from 'vitest';
import { P10BlockedError } from '@toto-wolff/core';
import type { P10Service } from '@toto-wolff/core';
import { handleP10Plan } from './p10_plan.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleP10Plan blocked handling', () => {
  it('returns a clean blocked result and does not leak the vault path', async () => {
    const leakyPath = 'P10-Plans/1718000000000-p10-plan.md';
    const stub = {
      runPlan: (): Promise<never> =>
        Promise.reject(new P10BlockedError(`P10 plan blocked. Plan saved to ${leakyPath}`)),
    } as unknown as P10Service;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await handleP10Plan({ task: 'add a health endpoint' }, stub);

    expect(result).toEqual({ status: 'blocked' });
    expect(JSON.stringify(result)).not.toContain('1718000000000');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('propagates non-P10BlockedError failures instead of swallowing them', async () => {
    const stub = {
      runPlan: (): Promise<never> =>
        Promise.reject(new Error('upstream failure')),
    } as unknown as P10Service;

    await expect(handleP10Plan({ task: 'x' }, stub)).rejects.toThrow('upstream failure');
  });
});
