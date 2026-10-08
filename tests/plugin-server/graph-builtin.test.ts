// The built-in idea-to-pr graph and the node `check` field (#63).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDEA_TO_PR, builtinGraphs } from '../../plugin/server/graph/builtin.mts';
import { findGraph, loadUserGraphs } from '../../plugin/server/graph/graphs.mts';
import { parseGraph } from '../../plugin/server/graph/validate.mts';

describe('the built-in idea-to-pr graph', () => {
  const graph = builtinGraphs()[0];

  it('is valid and follows the spec order', () => {
    expect(graph?.id).toBe(IDEA_TO_PR);
    expect(graph?.nodes.map((n) => n.id)).toEqual(['spec', 'council', 'approve-ruling', 'kind', 'rfc', 'adr', 'p10', 'approve-plan', 'safety-car', 'karpathy', 'approve-pr', 'pr']);
    expect(graph?.nodes.filter((n) => n.kind === 'human_gate')).toHaveLength(3);
  });

  it('uses the real skill names and checks the doc and PR steps (Safety Car S1)', () => {
    const byId = Object.fromEntries((graph?.nodes ?? []).map((n) => [n.id, n]));
    expect([byId.spec?.skill, byId.council?.skill, byId.p10?.skill, byId['safety-car']?.skill, byId.karpathy?.skill, byId.pr?.skill]).toEqual(['spec', 'llm-council', 'p10-bridge', 'safety-car', 'karpathy', 'ship']);
    expect([byId.rfc?.check, byId.adr?.check, byId.pr?.check]).toEqual(['rfc-doc', 'adr-doc', 'pr-url']);
    expect(byId.karpathy).toMatchObject({ kind: 'loop', maxIterations: 3 });
    expect(byId.karpathy?.instruction).toContain('passes only when every stage passes');
    for (const n of graph?.nodes ?? []) if (n.skill !== undefined) expect(n.instruction).toContain('did directly');
  });

  it('is a fresh object on every call (no shared module state)', () => {
    expect(builtinGraphs()[0]).not.toBe(graph);
  });
});

describe('the check field', () => {
  const base = (node: Record<string, unknown>): unknown => ({ id: 'g', version: 1, nodes: [node], edges: [] });

  it('is accepted on skill nodes only, from a fixed list', () => {
    expect(parseGraph(base({ id: 'a', kind: 'skill', skill: '/x', instruction: 'x', check: 'pr-url' })).nodes[0]?.check).toBe('pr-url');
    expect(() => parseGraph(base({ id: 'a', kind: 'loop', skill: '/x', instruction: 'x', check: 'pr-url' }))).toThrow('only skill nodes take a check');
    expect(() => parseGraph(base({ id: 'a', kind: 'skill', skill: '/x', instruction: 'x', check: 'shell' }))).toThrow('check must be one of rfc-doc, adr-doc, pr-url');
  });
});

describe('graph lookup', () => {
  it('finds the built-in graph and lists a user graph with its id as reserved (Safety Car S10)', async () => {
    const project = mkdtempSync(join(tmpdir(), 'toto-builtin-'));
    try {
      mkdirSync(join(project, '.toto', 'graphs'), { recursive: true });
      writeFileSync(join(project, '.toto', 'graphs', 'mine.json'), JSON.stringify({ id: IDEA_TO_PR, version: 1, nodes: [{ id: 'a', kind: 'skill', skill: '/a', instruction: 'a' }], edges: [] }));
      expect((await findGraph(project, IDEA_TO_PR)).nodes).toHaveLength(12);
      expect((await loadUserGraphs(project)).invalid).toEqual([{ file: 'mine.json', error: 'reserved id: idea-to-pr is built in' }]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
