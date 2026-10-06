// Iterate-until-pass loops (#62) through the real tools: spec criterion 7,
// retries, the optional iteration argument, and #61 state compatibility.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLineHandler } from '../../plugin/server/mcp/server.mts';
import type { LineHandler } from '../../plugin/server/mcp/server.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';

const skill = (id: string): Record<string, unknown> => ({ id, kind: 'skill', skill: `/${id}`, instruction: id });
const loopGraph = (id: string, maxIterations?: number): Record<string, unknown> => ({
  id,
  version: 1,
  nodes: [skill('a'), { id: 'k', kind: 'loop', skill: '/karpathy', instruction: 'build', ...(maxIterations === undefined ? {} : { maxIterations }) }, skill('z')],
  edges: [['a', 'k'], ['k', 'z']],
});

let project: string;
let handle: LineHandler;
let nextId = 0;

async function tool(name: string, args: Record<string, unknown>): Promise<{ body: Record<string, unknown>; isError: boolean; rpc?: unknown }> {
  const reply = (await handle(JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method: 'tools/call', params: { name, arguments: args } }))) as { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown };
  if (reply.result === undefined) return { body: {}, isError: true, rpc: reply.error };
  return { body: JSON.parse(reply.result.content[0]?.text ?? '{}') as Record<string, unknown>, isError: reply.result.isError === true };
}

// A run of `graph` with its first skill already passed, so the loop is current.
async function atLoop(graph: string, stopAt?: string): Promise<string> {
  const runId = String((await tool('graph_start', { graph, input: { idea: 'i' }, ...(stopAt === undefined ? {} : { stopAt }) })).body.runId);
  await tool('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'a' });
  return runId;
}

const report = (runId: string, outcome: 'pass' | 'fail', extra: Record<string, unknown> = {}): ReturnType<typeof tool> =>
  tool('graph_report', { runId, nodeId: 'k', outcome, evidence: `${outcome} ${JSON.stringify(extra)}`, ...extra });
const events = (runId: string): Record<string, unknown>[] =>
  readFileSync(join(project, '.toto', 'runs', runId, 'events.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
const stateOf = (runId: string): { nodes: Record<string, Record<string, unknown>> } =>
  JSON.parse(readFileSync(join(project, '.toto', 'runs', runId, 'state.json'), 'utf8')) as { nodes: Record<string, Record<string, unknown>> };

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'toto-loops-'));
  mkdirSync(join(project, '.toto', 'graphs'), { recursive: true });
  writeFileSync(join(project, '.toto', 'graphs', 'loop3.json'), JSON.stringify(loopGraph('loop3')));
  writeFileSync(join(project, '.toto', 'graphs', 'loop1.json'), JSON.stringify(loopGraph('loop1', 1)));
  handle = createLineHandler(createTools(createRuntime({ vault: join(project, 'vault'), project })));
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('spec criterion 7', () => {
  it('a loop that fails 3 times ends the run failed, with 3 iterations in events.jsonl', async () => {
    const runId = await atLoop('loop3');
    expect((await report(runId, 'fail')).body).toMatchObject({ status: 'running', step: { nodeId: 'k', iteration: 2 } });
    expect((await report(runId, 'fail')).body).toMatchObject({ status: 'running', step: { nodeId: 'k', iteration: 3 } });
    expect((await report(runId, 'fail')).body).toEqual({ runId, status: 'failed' });
    const log = events(runId);
    const loop = log.filter((e) => e.nodeId === 'k');
    expect(loop.map((e) => [e.type, e.iteration])).toEqual([['report', 1], ['report', 2], ['report', 3], ['failed', undefined]]);
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
  });
});

describe('loop attempts', () => {
  it('a pass after a fail completes the loop, the attempt recorded', async () => {
    const runId = await atLoop('loop3');
    await report(runId, 'fail');
    expect((await report(runId, 'pass')).body).toMatchObject({ status: 'running', step: { nodeId: 'z' } });
    expect(stateOf(runId).nodes.k).toEqual({ state: 'done', iteration: 2 });
    expect(events(runId).filter((e) => e.nodeId === 'k').map((e) => e.iteration)).toEqual([1, 2]);
  });

  it('maxIterations 1 fails the run on the first fail', async () => {
    expect((await report(await atLoop('loop1'), 'fail')).body).toMatchObject({ status: 'failed' });
  });

  it('writes no iteration until a fail advances it, and none on other nodes (Arbiter conditions 2 and 3)', async () => {
    const runId = await atLoop('loop3');
    expect(stateOf(runId).nodes).toEqual({ a: { state: 'done' }, k: { state: 'pending' }, z: { state: 'pending' } });
    expect(events(runId).find((e) => e.nodeId === 'a')).not.toHaveProperty('iteration');
    expect((await tool('graph_next', { runId })).body).toMatchObject({ step: { nodeId: 'k', iteration: 1 } });
  });

  it('graph_resume returns the current attempt', async () => {
    const runId = await atLoop('loop3');
    await report(runId, 'fail');
    expect((await tool('graph_resume', { runId })).body).toMatchObject({ step: { nodeId: 'k', iteration: 2 } });
  });

  it('a stopAt on the loop pauses after its passing attempt, not after a fail', async () => {
    const runId = await atLoop('loop3', 'k');
    expect((await report(runId, 'fail')).body).toMatchObject({ status: 'running' });
    expect((await report(runId, 'pass')).body).toEqual({ runId, status: 'stopped_at_target' });
  });
});

describe('the iteration argument (retry safety)', () => {
  it('ignores a retried fail for an attempt already applied, so no attempt is used up', async () => {
    const runId = await atLoop('loop3');
    await report(runId, 'fail', { iteration: 1 });
    expect((await report(runId, 'fail', { iteration: 1 })).body).toMatchObject({ step: { nodeId: 'k', iteration: 2 } });
    expect(events(runId).filter((e) => e.nodeId === 'k')).toHaveLength(1);
  });

  it('ignores a late pass for an earlier attempt: the loop stays on its current attempt (Safety Car S1)', async () => {
    const runId = await atLoop('loop3');
    await report(runId, 'fail', { iteration: 1 });
    expect((await report(runId, 'pass', { iteration: 1 })).body).toMatchObject({ status: 'running', step: { nodeId: 'k', iteration: 2 } });
    expect(stateOf(runId).nodes.k).toEqual({ state: 'pending', iteration: 2 });
  });

  it('rejects a future attempt with STALE_STEP', async () => {
    const r = await report(await atLoop('loop3'), 'fail', { iteration: 2 });
    expect(r).toMatchObject({ isError: true, body: { error: { code: 'STALE_STEP' } } });
  });

  it('keeps #61 order: a done loop with any iteration is a no-op; a failed run gives RUN_FINISHED (Safety Car S5)', async () => {
    const done = await atLoop('loop3');
    await report(done, 'pass');
    expect((await report(done, 'pass', { iteration: 3 })).isError).toBe(false);
    const failed = await atLoop('loop1');
    await report(failed, 'fail');
    expect(await report(failed, 'fail', { iteration: 1 })).toMatchObject({ isError: true, body: { error: { code: 'RUN_FINISHED' } } });
  });

  it.each([[0], [11], [1.5], ['2'], [null]])('rejects iteration %j as invalid input (-32602)', async (iteration) => {
    expect((await report('20990101-000000-abcdef', 'fail', { iteration })).rpc).toMatchObject({ code: -32602 });
  });

  it('is ignored on non-loop nodes', async () => {
    const runId = String((await tool('graph_start', { graph: 'loop3', input: { idea: 'i' } })).body.runId);
    expect((await tool('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'a', iteration: 5 })).body).toMatchObject({ step: { nodeId: 'k' } });
  });
});

describe('state files', () => {
  it('rejects an iteration outside 1..maxIterations, or on a non-loop node (Arbiter condition 1)', async () => {
    for (const nodes of [{ k: { state: 'pending', iteration: 4 } }, { k: { state: 'pending', iteration: 0 } }, { k: { state: 'pending', iteration: 1.5 } }, { k: { state: 'pending', iteration: '2' } }, { a: { state: 'done', iteration: 2 } }]) {
      const runId = await atLoop('loop3');
      const file = join(project, '.toto', 'runs', runId, 'state.json');
      const state = JSON.parse(readFileSync(file, 'utf8')) as { nodes: Record<string, unknown> };
      writeFileSync(file, JSON.stringify({ ...state, nodes: { ...state.nodes, ...nodes } }));
      expect((await tool('graph_status', { runId })).rpc).toMatchObject({ code: -32603 });
    }
  });
});
