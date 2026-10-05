// The run state machine (#61): readiness in node order, choice pruning and
// joins, stopAt (including skipped targets), gates, failure, idempotent
// retries and the error order.
import { describe, expect, it } from 'vitest';
import { approveNode, createRun, currentStep, reportNode, resumeRun } from '../../plugin/server/graph/engine.mts';
import type { RunState, Transition } from '../../plugin/server/graph/engine.mts';
import { parseGraph } from '../../plugin/server/graph/validate.mts';

const NOW = '2026-10-05T00:00:00.000Z';
const skill = (id: string): Record<string, unknown> => ({ id, kind: 'skill', skill: `/${id}`, instruction: `do ${id}` });
const gate = (id: string): Record<string, unknown> => ({ id, kind: 'human_gate', instruction: `approve ${id}?` });

// s -> c(choice rfc:r | adr:d) -> r|d -> j -> g(gate) -> z
const FORK = parseGraph({
  id: 'fork',
  version: 1,
  nodes: [skill('s'), { id: 'c', kind: 'choice', instruction: 'pick', options: { rfc: ['r'], adr: ['d'] } }, skill('r'), skill('d'), skill('j'), gate('g'), { id: 'z', kind: 'loop', skill: '/z', instruction: 'loop z' }],
  edges: [['s', 'c'], ['c', 'r'], ['c', 'd'], ['r', 'j'], ['d', 'j'], ['j', 'g'], ['g', 'z']],
});

const start = (stopAt: string | null = null): RunState => createRun(FORK, 'r1', 'idea', stopAt, NOW).state;
const states = (s: RunState): Record<string, string> => Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, v.state]));
const pass = (s: RunState, id: string, choice?: string): Transition => reportNode(s, id, 'pass', choice);

function runTo(s: RunState, ids: readonly string[]): RunState {
  let state = s;
  for (const id of ids) state = (id === 'g' ? approveNode(state, id, 'approve') : pass(state, id, id === 'c' ? 'adr' : undefined)).state;
  return state;
}

describe('a run from start to done', () => {
  it('starts on the start node with a start event', () => {
    const t = createRun(FORK, 'r1', 'idea', null, NOW);
    expect(t.state).toMatchObject({ status: 'running', current: 's', stopAt: null, eventSeq: 0 });
    expect(t.events).toEqual([{ type: 'start', stopAt: null }]);
    expect(currentStep(t.state)).toEqual({ nodeId: 's', kind: 'skill', skill: '/s', instruction: 'do s' });
  });

  it('prunes the losing option, runs the join once, waits at the gate, runs the loop once, then is done', () => {
    let s = pass(start(), 's').state;
    const chose = pass(s, 'c', 'adr');
    expect(chose.events).toEqual([{ type: 'report', nodeId: 'c', outcome: 'pass', choice: 'adr' }]);
    s = chose.state;
    expect(states(s)).toMatchObject({ r: 'skipped', d: 'pending' });
    expect(s.current).toBe('d');
    s = runTo(s, ['d', 'j']);
    expect(s).toMatchObject({ status: 'awaiting_approval', current: 'g' });
    s = approveNode(s, 'g', 'approve').state;
    expect(currentStep(s)).toEqual({ nodeId: 'z', kind: 'loop', skill: '/z', instruction: 'loop z', iteration: 1 });
    const end = pass(s, 'z');
    expect(end.state).toMatchObject({ status: 'done', current: null });
    expect(end.events.at(-1)).toEqual({ type: 'done' });
    expect(states(end.state)).toEqual({ s: 'done', c: 'done', r: 'skipped', d: 'done', j: 'done', g: 'done', z: 'done' });
  });

  it('never changes the state it was given', () => {
    const before = start();
    const copy = structuredClone(before);
    pass(before, 's');
    expect(before).toEqual(copy);
  });
});

describe('choices', () => {
  it.each([[undefined], ['nope'], ['constructor']])('rejects choice %j with INVALID_CHOICE', (choice) => {
    const s = pass(start(), 's').state;
    expect(() => pass(s, 'c', choice)).toThrow(expect.objectContaining({ code: 'INVALID_CHOICE' }) as Error);
  });

  it('rejects a choice on a non-choice node', () => {
    expect(() => pass(start(), 's', 'rfc')).toThrow(expect.objectContaining({ code: 'INVALID_CHOICE' }) as Error);
  });

  it('skips a whole pruned branch, not just the option node', () => {
    const g = parseGraph({
      id: 'deep', version: 1,
      nodes: [skill('s'), { id: 'c', kind: 'choice', instruction: 'pick', options: { a: ['a1'], b: ['b1'] } }, skill('a1'), skill('a2'), skill('b1'), skill('j')],
      edges: [['s', 'c'], ['c', 'a1'], ['a1', 'a2'], ['c', 'b1'], ['a2', 'j'], ['b1', 'j']],
    });
    let s = createRun(g, 'r', 'i', null, NOW).state;
    s = pass(s, 's').state;
    const t = pass(s, 'c', 'b');
    expect(states(t.state)).toMatchObject({ a1: 'skipped', a2: 'skipped', b1: 'pending' });
    expect(t.events).toContainEqual({ type: 'skip', nodeIds: ['a2'] });
  });
});

describe('stopAt', () => {
  it('pauses after the target completes and stops offering steps', () => {
    const t = pass(start('s'), 's');
    expect(t.state).toMatchObject({ status: 'stopped_at_target', current: 'c' });
    expect(t.events.at(-1)).toEqual({ type: 'stop', nodeId: 's' });
    expect(currentStep(t.state)).toBeNull();
  });

  it('pauses after a loop target passes', () => {
    const s = runTo(start('z'), ['s', 'c', 'd', 'j', 'g', 'z']);
    expect(s.status).toBe('done');
    const before = runTo(start('j'), ['s', 'c', 'd', 'j']);
    expect(before).toMatchObject({ status: 'stopped_at_target', current: 'g' });
  });

  it('pauses at the next step when a choice skips the target', () => {
    const s = runTo(start('r'), ['s', 'c']);
    expect(s).toMatchObject({ status: 'stopped_at_target', current: 'd' });
  });

  it('pauses at the chosen option when the target is pruned, then finishes after a resume', () => {
    const g = parseGraph({ id: 'end', version: 1, nodes: [skill('s'), { id: 'c', kind: 'choice', instruction: 'p', options: { a: ['a'], b: ['b'] } }, skill('a'), skill('b')], edges: [['s', 'c'], ['c', 'a'], ['c', 'b']] });
    let s = createRun(g, 'r', 'i', 'a', NOW).state;
    s = pass(s, 's').state;
    s = pass(s, 'c', 'b').state;
    expect(s.status).toBe('stopped_at_target');
    s = resumeRun(s, undefined).state;
    expect(pass(s, 'b').state.status).toBe('done');
  });

  it('rejects an unknown target at start', () => {
    expect(() => createRun(FORK, 'r', 'i', 'nope', NOW)).toThrow(expect.objectContaining({ code: 'UNKNOWN_NODE' }) as Error);
  });
});

describe('resume', () => {
  it('continues a stopped run to the end when no new target is given', () => {
    const stopped = pass(start('s'), 's').state;
    const t = resumeRun(stopped, undefined);
    expect(t.state).toMatchObject({ status: 'running', current: 'c', stopAt: null });
    expect(t.events).toEqual([{ type: 'target', stopAt: null }]);
  });

  it('continues a stopped run to a new target', () => {
    const stopped = pass(start('s'), 's').state;
    const s = resumeRun(stopped, 'j').state;
    expect(runTo(s, ['c', 'd', 'j'])).toMatchObject({ status: 'stopped_at_target', current: 'g' });
  });

  it('changes nothing (and logs nothing) for a running run without a new target', () => {
    const s = start();
    expect(resumeRun(s, undefined)).toEqual({ state: s, events: [] });
  });

  it('rejects a completed target with UNKNOWN_NODE (Arbiter condition 10)', () => {
    const s = pass(start(), 's').state;
    expect(() => resumeRun(s, 's')).toThrow(expect.objectContaining({ code: 'UNKNOWN_NODE', message: 'stopAt s is already completed' }) as Error);
  });

  it('stops at once on a target already skipped (Safety Car S13)', () => {
    const s = runTo(start(), ['s', 'c']);
    expect(resumeRun(s, 'r').state).toMatchObject({ status: 'stopped_at_target', current: 'd' });
  });

  it('rejects a finished run with RUN_FINISHED', () => {
    const failed = reportNode(start(), 's', 'fail').state;
    expect(() => resumeRun(failed, undefined)).toThrow(expect.objectContaining({ code: 'RUN_FINISHED' }) as Error);
  });
});

describe('gates, failure and the error order', () => {
  it('fails the run on a failed report and on a rejected gate', () => {
    const f = reportNode(start(), 's', 'fail');
    expect(f.state).toMatchObject({ status: 'failed', current: null });
    expect(f.events).toEqual([{ type: 'report', nodeId: 's', outcome: 'fail' }, { type: 'failed', nodeId: 's' }]);
    const atGate = runTo(start(), ['s', 'c', 'd', 'j']);
    expect(approveNode(atGate, 'g', 'reject').state.status).toBe('failed');
  });

  it('returns the state unchanged for a repeated report of a completed node', () => {
    const s = pass(start(), 's').state;
    expect(pass(s, 's')).toEqual({ state: s, events: [] });
  });

  it('returns the state, not RUN_FINISHED, for a retried final report on a done run (S14)', () => {
    const done = runTo(start(), ['s', 'c', 'd', 'j', 'g', 'z']);
    expect(done.status).toBe('done');
    expect(pass(done, 'z')).toEqual({ state: done, events: [] });
    expect(approveNode(done, 'g', 'approve')).toEqual({ state: done, events: [] });
  });

  it.each([
    ['an unknown node', (s: RunState): Transition => pass(s, 'nope'), 'UNKNOWN_NODE'],
    ['a node that is not current', (s: RunState): Transition => pass(s, 'j'), 'STALE_STEP'],
    ['a report on a gate', (s: RunState): Transition => pass(runTo(s, ['s', 'c', 'd', 'j']), 'g'), 'NOT_A_GATE'],
    ['an approval of a non-gate', (s: RunState): Transition => approveNode(s, 's', 'approve'), 'NOT_A_GATE'],
    ['a report on a finished run', (s: RunState): Transition => pass(reportNode(s, 's', 'fail').state, 'c'), 'RUN_FINISHED'],
    ['a report while stopped at the target', (): Transition => pass(pass(createRun(FORK, 'r', 'i', 's', NOW).state, 's').state, 'c', 'adr'), 'STALE_STEP'],
  ])('%s -> %s', (_name, act, code) => {
    expect(() => act(start())).toThrow(expect.objectContaining({ code }) as Error);
  });
});
