import { describe, expect, it } from 'vitest';
import { parseSafetyCarRisks } from './SafetyCarService.js';

const PLAN = 'P10-Plans/plan.md';

describe('parseSafetyCarRisks', () => {
  it('maps each risk and falls back to the plan path for a missing planRef', () => {
    const raw = JSON.stringify({
      risks: [
        { category: 'abuse_vector', severity: 'high', description: 'd1', mitigation: 'm1', planRef: 'own.md' },
        { category: 'blast_radius', severity: 'low', description: 'd2', mitigation: 'm2' },
      ],
    });

    const risks = parseSafetyCarRisks(raw, PLAN);

    expect(risks).toHaveLength(2);
    expect(risks[0]).toEqual({
      category: 'abuse_vector',
      severity: 'high',
      description: 'd1',
      mitigation: 'm1',
      planRef: 'own.md',
    });
    expect(risks[1]?.planRef).toBe(PLAN);
  });

  it('coerces a missing description and mitigation to empty strings', () => {
    const raw = JSON.stringify({ risks: [{ category: 'runtime_failure', severity: 'critical' }] });

    expect(parseSafetyCarRisks(raw, PLAN)[0]).toMatchObject({ description: '', mitigation: '' });
  });

  it.each([['not json at all'], ['null'], ['{"risks": "nope"}'], ['{}'], ['{"risks": []}']])(
    'returns an empty list for %j',
    (raw) => {
      expect(parseSafetyCarRisks(raw, PLAN)).toEqual([]);
    },
  );
});
