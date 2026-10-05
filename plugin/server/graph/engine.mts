// The run state machine, as pure functions over a copy of the run state
// (spec "Semantics"). Nothing here touches the filesystem: store.mts saves
// what these functions return. Each transition returns the new state and the
// events it caused; evidence and notes are added to those events by the tool
// layer and never kept in the state (Safety Car S11).
import assert from 'node:assert/strict';
import { GraphError, MAX_NODES, hasKey } from './model.mts';
import type { Graph, GraphNode, NodeKind } from './model.mts';
import { predecessors } from './validate.mts';

export type NodeState = 'pending' | 'done' | 'skipped' | 'failed';
export type RunStatus = 'running' | 'awaiting_approval' | 'stopped_at_target' | 'done' | 'failed';

export interface NodeRecord {
  state: NodeState;
  choice?: string;
}

export interface RunState {
  version: 1;
  runId: string;
  graphId: string;
  graph: Graph;
  input: { idea: string };
  // Pause after this node completes; null runs to the end.
  stopAt: string | null;
  status: RunStatus;
  nodes: Record<string, NodeRecord>;
  current: string | null;
  eventSeq: number;
  updatedAt: string;
}

export interface Step {
  nodeId: string;
  kind: NodeKind;
  skill?: string;
  instruction: string;
  iteration?: number;
}

export interface EngineEvent {
  type: 'start' | 'report' | 'approve' | 'skip' | 'stop' | 'target' | 'done' | 'failed';
  nodeId?: string;
  nodeIds?: string[];
  outcome?: 'pass' | 'fail';
  decision?: 'approve' | 'reject';
  choice?: string;
  stopAt?: string | null;
}

export interface Transition {
  state: RunState;
  events: EngineEvent[];
}

const FINISHED: readonly RunStatus[] = ['done', 'failed'];

function nodeOf(state: RunState, nodeId: string): GraphNode | undefined {
  return state.graph.nodes.find((n) => n.id === nodeId);
}

function recordOf(state: RunState, nodeId: string): NodeRecord {
  const record = hasKey(state.nodes, nodeId) ? state.nodes[nodeId] : undefined;
  assert.ok(record !== undefined, `node ${nodeId} has a record`);
  return record;
}

// READY: pending, and every predecessor done or skipped with at least one
// done; the start node (no predecessors) is ready while pending.
function isReady(state: RunState, nodeId: string, preds: ReadonlyMap<string, string[]>): boolean {
  if (recordOf(state, nodeId).state !== 'pending') return false;
  const from = preds.get(nodeId) ?? [];
  assert.ok(from.length <= MAX_NODES, 'a node has at most MAX_NODES predecessors');
  if (from.length === 0) return true;
  const states = from.map((p) => recordOf(state, p).state);
  return states.every((s) => s === 'done' || s === 'skipped') && states.includes('done');
}

// A pending node whose predecessors are all skipped is skipped too, to a
// fixed point. Returns the newly skipped ids in node order.
function propagateSkips(state: RunState, preds: ReadonlyMap<string, string[]>): string[] {
  const skipped: string[] = [];
  // LOOP BOUND: at most MAX_NODES passes (each pass that changes anything skips >= 1 node).
  for (let pass = 0; pass < MAX_NODES; pass++) {
    let changed = false;
    // LOOP BOUND: at most MAX_NODES nodes.
    for (const node of state.graph.nodes) {
      const from = preds.get(node.id) ?? [];
      if (recordOf(state, node.id).state !== 'pending' || from.length === 0) continue;
      if (from.every((p) => recordOf(state, p).state === 'skipped')) {
        recordOf(state, node.id).state = 'skipped';
        skipped.push(node.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  assert.ok(skipped.length <= MAX_NODES, 'no node is skipped twice');
  return skipped;
}

// Sets `current` to the first ready node in `nodes` order and the status
// from its kind; with no ready node the run is done.
function advance(state: RunState, preds: ReadonlyMap<string, string[]>): EngineEvent[] {
  const next = state.graph.nodes.find((n) => isReady(state, n.id, preds));
  if (next === undefined) {
    const open = state.graph.nodes.filter((n) => recordOf(state, n.id).state === 'pending');
    assert.equal(open.length, 0, 'a valid DAG leaves no pending node without a ready one');
    state.current = null;
    state.status = 'done';
    return [{ type: 'done' }];
  }
  state.current = next.id;
  state.status = next.kind === 'human_gate' ? 'awaiting_approval' : 'running';
  assert.ok(isReady(state, next.id, preds), 'the current node is ready');
  return [];
}

// After a node completes: prune, advance, then stop if the target is now done
// or skipped and a step remains (spec: pause after the target; a skipped
// target pauses at the next step; with no step left the run is done).
function settle(state: RunState): EngineEvent[] {
  const preds = predecessors(state.graph);
  const events: EngineEvent[] = [];
  const skipped = propagateSkips(state, preds);
  if (skipped.length > 0) events.push({ type: 'skip', nodeIds: skipped });
  events.push(...advance(state, preds));
  const target = state.stopAt;
  if (target !== null && state.status !== 'done') {
    const reached = recordOf(state, target).state;
    if (reached === 'done' || reached === 'skipped') {
      state.status = 'stopped_at_target';
      events.push({ type: 'stop', nodeId: target });
    }
  }
  assert.ok(state.status !== 'failed', 'settle never fails a run');
  return events;
}

function begin(state: RunState): RunState {
  assert.equal(state.version, 1, 'a version 1 run state');
  const copy = structuredClone(state);
  assert.ok(copy !== state, 'transitions work on a copy');
  return copy;
}

/** A new run of `graph`, settled on its start node. */
export function createRun(graph: Graph, runId: string, idea: string, stopAt: string | null, now: string): Transition {
  assert.ok(graph.nodes.length >= 1 && graph.nodes.length <= MAX_NODES, 'a validated graph');
  if (stopAt !== null && !graph.nodes.some((n) => n.id === stopAt)) {
    throw new GraphError('UNKNOWN_NODE', `stopAt ${stopAt.slice(0, 40)} is not a node of graph ${graph.id}`);
  }
  const nodes: Record<string, NodeRecord> = Object.create(null) as Record<string, NodeRecord>;
  for (const node of graph.nodes) nodes[node.id] = { state: 'pending' };
  const state: RunState = { version: 1, runId, graphId: graph.id, graph, input: { idea }, stopAt, status: 'running', nodes, current: null, eventSeq: 0, updatedAt: now };
  const events = advance(state, predecessors(graph));
  assert.ok(state.current !== null, 'a new run has a current step');
  return { state, events: [{ type: 'start', stopAt }, ...events] };
}

/** The step in flight, or null when the run is stopped or finished. */
export function currentStep(state: RunState): Step | null {
  if (state.current === null || (state.status !== 'running' && state.status !== 'awaiting_approval')) return null;
  const node = nodeOf(state, state.current);
  assert.ok(node !== undefined, 'the current node is in the graph');
  const step: Step = { nodeId: node.id, kind: node.kind, instruction: node.instruction };
  if (node.skill !== undefined) step.skill = node.skill;
  // #61 runs a loop node once; #62 adds the further iterations.
  if (node.kind === 'loop') step.iteration = 1;
  assert.equal(step.nodeId, state.current, 'the step is the current node');
  return step;
}

// Shared checks for graph_report and graph_approve, in the order that makes a
// retried call safe: an already-completed node returns the state unchanged,
// even on a finished run (Safety Car S14). Returns true for that no-op.
function checkTarget(state: RunState, nodeId: string, wantGate: boolean): boolean {
  const node = nodeOf(state, nodeId);
  if (node === undefined) throw new GraphError('UNKNOWN_NODE', `node ${nodeId.slice(0, 40)} is not in graph ${state.graphId}`);
  if (recordOf(state, nodeId).state === 'done') return true;
  if (FINISHED.includes(state.status)) throw new GraphError('RUN_FINISHED', `run ${state.runId} is ${state.status}`);
  if (wantGate && node.kind !== 'human_gate') throw new GraphError('NOT_A_GATE', `node ${nodeId} is a ${node.kind} node, not a human_gate: report it with graph_report`);
  if (!wantGate && node.kind === 'human_gate') throw new GraphError('NOT_A_GATE', `node ${nodeId} is a human_gate: approve or reject it with graph_approve`);
  if (state.status === 'stopped_at_target') throw new GraphError('STALE_STEP', `run ${state.runId} is stopped at its target; call graph_resume`);
  if (state.current !== nodeId) throw new GraphError('STALE_STEP', `node ${nodeId} is not the current step (current: ${state.current ?? 'none'})`);
  assert.ok(recordOf(state, nodeId).state === 'pending', 'the current node is pending');
  return false;
}

function fail(state: RunState, nodeId: string): EngineEvent[] {
  recordOf(state, nodeId).state = 'failed';
  state.current = null;
  state.status = 'failed';
  assert.equal(state.status, 'failed', 'the run failed');
  return [{ type: 'failed', nodeId }];
}

// A choice marks the nodes of every other option skipped.
function applyChoice(state: RunState, node: GraphNode, choice: string | undefined): string {
  const options = node.options;
  assert.ok(options !== undefined, 'a choice node has options');
  if (choice === undefined || !hasKey(options, choice)) {
    throw new GraphError('INVALID_CHOICE', `node ${node.id} needs a choice, one of: ${Object.keys(options).join(', ')}`);
  }
  for (const key of Object.keys(options)) {
    if (key === choice) continue;
    for (const id of options[key] ?? []) if (recordOf(state, id).state === 'pending') recordOf(state, id).state = 'skipped';
  }
  recordOf(state, node.id).choice = choice;
  assert.equal(recordOf(state, node.id).choice, choice, 'the choice is recorded');
  return choice;
}

/** graph_report for a skill, choice or loop node. */
export function reportNode(prior: RunState, nodeId: string, outcome: 'pass' | 'fail', choice: string | undefined): Transition {
  if (checkTarget(prior, nodeId, false)) return { state: prior, events: [] };
  const state = begin(prior);
  const node = nodeOf(state, nodeId);
  assert.ok(node !== undefined, 'checkTarget found the node');
  if (node.kind !== 'choice' && choice !== undefined) throw new GraphError('INVALID_CHOICE', `node ${nodeId} is not a choice node`);
  const reported: EngineEvent = { type: 'report', nodeId, outcome };
  if (outcome === 'fail') return { state, events: [reported, ...fail(state, nodeId)] };
  if (node.kind === 'choice') {
    reported.choice = applyChoice(state, node, choice);
  }
  recordOf(state, nodeId).state = 'done';
  return { state, events: [reported, ...settle(state)] };
}

/** graph_approve for a human_gate node: approve completes it, reject fails the run. */
export function approveNode(prior: RunState, nodeId: string, decision: 'approve' | 'reject'): Transition {
  if (checkTarget(prior, nodeId, true)) return { state: prior, events: [] };
  const state = begin(prior);
  const decided: EngineEvent = { type: 'approve', nodeId, decision };
  if (decision === 'reject') return { state, events: [decided, ...fail(state, nodeId)] };
  recordOf(state, nodeId).state = 'done';
  assert.equal(recordOf(state, nodeId).state, 'done', 'the gate is done');
  return { state, events: [decided, ...settle(state)] };
}

/**
 * graph_resume: an optional new target (a node not yet completed) replaces
 * the old one; a run stopped at its target continues (to the new target, or
 * to the end when none is given).
 */
export function resumeRun(prior: RunState, stopAt: string | undefined): Transition {
  if (FINISHED.includes(prior.status)) throw new GraphError('RUN_FINISHED', `run ${prior.runId} is ${prior.status}`);
  if (stopAt !== undefined) {
    if (nodeOf(prior, stopAt) === undefined) throw new GraphError('UNKNOWN_NODE', `stopAt ${stopAt.slice(0, 40)} is not a node of graph ${prior.graphId}`);
    if (recordOf(prior, stopAt).state === 'done') throw new GraphError('UNKNOWN_NODE', `stopAt ${stopAt} is already completed`);
  }
  const wasStopped = prior.status === 'stopped_at_target';
  const target = stopAt ?? (wasStopped ? null : prior.stopAt);
  if (!wasStopped && target === prior.stopAt) return { state: prior, events: [] };
  const state = begin(prior);
  state.stopAt = target;
  const events: EngineEvent[] = [{ type: 'target', stopAt: target }];
  if (wasStopped) state.status = 'running';
  events.push(...settle(state));
  assert.ok(!FINISHED.includes(state.status) || state.status === 'done', 'a resume never fails a run');
  return { state, events };
}
