import { describe, it, expect } from 'vitest';
import { HookSystem } from './HookSystem.js';
import type { HookExecutor, HookContext, HookResult } from './HookTypes.js';

const CONTEXT: HookContext = { tool: 'Write', input: {}, metadata: {}, timestamp: 0 };

function executor(id: string, priority: number, result: HookResult): HookExecutor {
  return { id, name: id, priority, execute: (): HookResult => result };
}

describe('HookSystem.execute()', () => {
  it('returns a plain allow when no executor accepted an override', async () => {
    const hooks = new HookSystem();
    hooks.register(executor('a', 1, { allowed: true }));

    expect(await hooks.execute(CONTEXT)).toEqual({ allowed: true });
  });

  it('preserves override and overrideReason from an executor that accepted one (regression)', async () => {
    const hooks = new HookSystem();
    hooks.register(executor('drs', 1, { allowed: true, override: true, overrideReason: 'approved by owner' }));
    hooks.register(executor('other', 2, { allowed: true }));

    // Previously replaced with a fresh { allowed: true }, so a caller could
    // not tell an override-allow from an ordinary allow.
    expect(await hooks.execute(CONTEXT)).toEqual({
      allowed: true,
      override: true,
      overrideReason: 'approved by owner',
    });
  });

  it('a later executor that blocks wins over an earlier accepted override', async () => {
    const hooks = new HookSystem();
    hooks.register(executor('drs', 1, { allowed: true, override: true, overrideReason: 'x' }));
    hooks.register(executor('blocker', 2, { allowed: false, ruleFired: 2, reason: 'no' }));

    expect(await hooks.execute(CONTEXT)).toEqual({ allowed: false, ruleFired: 2, reason: 'no' });
  });
});
