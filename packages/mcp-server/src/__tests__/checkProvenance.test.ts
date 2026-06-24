import { describe, it, expect } from 'vitest';
import { checkProvenance } from '../handlers/checkProvenance.js';

describe('checkProvenance', () => {
  it('returns ok:true when all claimed IDs are in the session', () => {
    const result = checkProvenance(['adr-0006', 'adr-0007'], ['adr-0006', 'adr-0007', 'adr-0005']);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.loop_informed).toBe(true);
  });

  it('returns ok:false and names the missing ID — fail-closed reject', () => {
    const result = checkProvenance(['adr-0006', 'adr-0099'], ['adr-0006']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['adr-0099']);
  });

  it('returns loop_informed:false when session is empty', () => {
    const result = checkProvenance([], []);
    expect(result.loop_informed).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for every claimed ID not in session (cold-start claim forgery)', () => {
    const result = checkProvenance(['adr-0001', 'adr-0002'], []);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['adr-0001', 'adr-0002']);
    expect(result.loop_informed).toBe(false);
  });

  it('returns ok:true when claimed list is empty — cold-start stamp is always valid', () => {
    const result = checkProvenance([], ['adr-0006', 'adr-0007']);
    expect(result.ok).toBe(true);
    expect(result.loop_informed).toBe(true);
  });
});
