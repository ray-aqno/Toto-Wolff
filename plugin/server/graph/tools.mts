// The eight graph tools. A malformed argument is -32602 (as for every tool);
// a graph failure is a tool result `{ error: { code, message } }` with
// isError: true (spec). Evidence, artifacts and notes go to events.jsonl
// only, never into state.json (Safety Car S11).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { INVALID_PARAMS, RpcError, isRecord } from '../mcp/protocol.mts';
import type { Message } from '../mcp/protocol.mts';
import type { Tool, ToolDefinition } from '../mcp/server.mts';
import { approveNode, createRun, currentStep, reportNode, resumeRun } from './engine.mts';
import type { RunState, Step, Transition } from './engine.mts';
import { builtinGraphs } from './builtin.mts';
import { checkDoc, checkPrUrl, docKindOf, ideaSlug, nextDocPath } from './checks.mts';
import { findGraph, loadUserGraphs } from './graphs.mts';
import { assertNotBusy, withRunLock } from './lock.mts';
import { GraphError, MAX_ITERATIONS } from './model.mts';
import { appendEvents, ensureRunsDir, newRunId, readState, runDir, writeState } from './store.mts';
import { TEMPLATE_KINDS, isTemplateKind, templateFor } from './templates.mts';

const MAX_IDEA = 4096;
const MAX_EVIDENCE = 16384;
const MAX_NOTE = 4096;
const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT = 1024;
const ID = { type: 'string' } as const;
const RUN = { runId: ID } as const;

export const GRAPH_DEFINITIONS: readonly ToolDefinition[] = [
  { name: 'graph_list', description: 'List the task graphs this project can run', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_template', description: 'Get the RFC or ADR document template (Markdown)', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: [...TEMPLATE_KINDS] } }, required: ['kind'] } },
  { name: 'graph_start', description: 'Start a run of a graph; returns the run id and the first step', inputSchema: { type: 'object', properties: { graph: ID, input: { type: 'object', properties: { idea: ID }, required: ['idea'] }, stopAt: ID }, required: ['graph', 'input'] } },
  { name: 'graph_next', description: "Get a run's current step (read-only)", inputSchema: { type: 'object', properties: RUN, required: ['runId'] } },
  { name: 'graph_report', description: 'Report the outcome of the current skill, choice or loop step', inputSchema: { type: 'object', properties: { ...RUN, nodeId: ID, outcome: { type: 'string', enum: ['pass', 'fail'] }, evidence: ID, artifacts: { type: 'array', items: ID }, choice: ID, iteration: { type: 'integer', minimum: 1, maximum: MAX_ITERATIONS } }, required: ['runId', 'nodeId', 'outcome', 'evidence'] } },
  { name: 'graph_approve', description: "Record a person's decision at a human_gate step (ask the user first)", inputSchema: { type: 'object', properties: { ...RUN, nodeId: ID, decision: { type: 'string', enum: ['approve', 'reject'] }, note: ID }, required: ['runId', 'nodeId', 'decision'] } },
  { name: 'graph_status', description: "Get a run's status and the state of every node", inputSchema: { type: 'object', properties: RUN, required: ['runId'] } },
  { name: 'graph_resume', description: 'Continue a run from its last checkpoint; optionally set a new stop target', inputSchema: { type: 'object', properties: { ...RUN, stopAt: ID }, required: ['runId'] } },
];

function text(name: string, args: Record<string, unknown>, max: number): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RpcError(INVALID_PARAMS, `${name} must be a string of 1 to ${String(max)} characters`);
  return value;
}

function optionalText(name: string, args: Record<string, unknown>, max: number): string | undefined {
  return args[name] === undefined ? undefined : text(name, args, max);
}

function oneOf<T extends string>(name: string, args: Record<string, unknown>, allowed: readonly T[]): T {
  const value = args[name];
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new RpcError(INVALID_PARAMS, `${name} must be one of: ${allowed.join(', ')}`);
  return found;
}

// A loop attempt number: absent, or an integer 1..MAX_ITERATIONS.
function iterationOf(args: Record<string, unknown>): number | undefined {
  const raw = args['iteration'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > MAX_ITERATIONS) {
    throw new RpcError(INVALID_PARAMS, `iteration must be an integer from 1 to ${String(MAX_ITERATIONS)}`);
  }
  return raw;
}

function artifactsOf(args: Record<string, unknown>): string[] | undefined {
  const raw = args['artifacts'];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_ARTIFACTS || !raw.every((a) => typeof a === 'string' && a.length > 0 && a.length <= MAX_ARTIFACT)) {
    throw new RpcError(INVALID_PARAMS, `artifacts must be at most ${String(MAX_ARTIFACTS)} strings of 1 to ${String(MAX_ARTIFACT)} characters`);
  }
  return raw as string[];
}

type StepView = Step & { doc?: { path: string } | { error: string } };

// The run's status and step; a document step also gets where to write it.
async function view(projectDir: string, state: RunState): Promise<{ runId: string; status: string; step?: StepView }> {
  const step: StepView | null = currentStep(state);
  if (step === null) return { runId: state.runId, status: state.status };
  const kind = docKindOf(state.graph.nodes.find((n) => n.id === step.nodeId)?.check);
  if (kind !== null) {
    // A filesystem problem is a reason on the step, never a thrown error.
    step.doc = await nextDocPath(projectDir, kind, ideaSlug(state.input.idea)).then(
      (path) => ({ path }),
      (err: unknown) => ({ error: err instanceof GraphError ? `${err.code}: ${err.message}` : String(err) }),
    );
  }
  assert.ok(step.nodeId === state.current, 'the view shows the current step');
  return { runId: state.runId, status: state.status, step };
}

// Saves a transition: state first (atomic), then its events numbered from
// the state's eventSeq; `extra` is merged into the first event (evidence).
async function save(projectDir: string, t: Transition, extra: Record<string, unknown>): Promise<void> {
  if (t.events.length === 0) return;
  const first = t.state.eventSeq + 1;
  const now = new Date().toISOString();
  t.state.eventSeq += t.events.length;
  t.state.updatedAt = now;
  await writeState(projectDir, t.state);
  const events = t.events.map((e, i): object => (i === 0 ? { ...e, ...extra } : e));
  await appendEvents(projectDir, t.state.runId, events, first, now);
  assert.ok(t.state.eventSeq >= first, 'the sequence advanced');
}

async function start(projectDir: string, args: Record<string, unknown>): Promise<unknown> {
  const id = text('graph', args, 40);
  const input = args['input'];
  if (!isRecord(input)) throw new RpcError(INVALID_PARAMS, 'input must be an object with an idea');
  const idea = text('idea', input, MAX_IDEA);
  const stopAt = optionalText('stopAt', args, 40) ?? null;
  const graph = await findGraph(projectDir, id);
  const runId = newRunId(new Date());
  const t = createRun(graph, runId, idea, stopAt, new Date().toISOString());
  await ensureRunsDir(projectDir);
  const dir = runDir(projectDir, runId);
  await mkdir(dir);
  await withRunLock(dir, runId, () => save(projectDir, t, {}));
  return view(projectDir, t.state);
}

// A state-changing call: under the run's lock, read, check (optional),
// transition, save.
async function change(projectDir: string, runId: string, step: (s: RunState) => Transition, extra: Record<string, unknown>, before?: (s: RunState) => Promise<void>): Promise<unknown> {
  const dir = runDir(projectDir, runId);
  await readState(projectDir, runId);
  return withRunLock(dir, runId, async () => {
    const state = await readState(projectDir, runId);
    if (before !== undefined) await before(state);
    const t = step(state);
    await save(projectDir, t, extra);
    return view(projectDir, t.state);
  });
}

// The evidence check of a checked node, only for a `pass` of the current,
// pending step of a running run (Arbiter condition 1): a repeated report of
// a done node is never re-checked and stays a no-op.
async function checkEvidence(projectDir: string, state: RunState, nodeId: string, evidence: string, artifacts: string[] | undefined): Promise<void> {
  if (state.status !== 'running' || state.current !== nodeId || state.nodes[nodeId]?.state !== 'pending') return;
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  assert.ok(node !== undefined, 'the current node is in the graph');
  const kind = docKindOf(node.check);
  if (kind !== null) await checkDoc(projectDir, kind, state.input.idea, artifacts?.[0]);
  else if (node.check === 'pr-url') checkPrUrl(evidence);
}

function report(projectDir: string, args: Record<string, unknown>): Promise<unknown> {
  const runId = text('runId', args, 64);
  const nodeId = text('nodeId', args, 40);
  const outcome = oneOf('outcome', args, ['pass', 'fail'] as const);
  const evidence = text('evidence', args, MAX_EVIDENCE);
  const artifacts = artifactsOf(args);
  const choice = optionalText('choice', args, 40);
  const iteration = iterationOf(args);
  const extra = artifacts === undefined ? { evidence } : { evidence, artifacts };
  const before = outcome === 'pass' ? (s: RunState): Promise<void> => checkEvidence(projectDir, s, nodeId, evidence, artifacts) : undefined;
  return change(projectDir, runId, (s) => reportNode(s, nodeId, outcome, choice, iteration), extra, before);
}

function approve(projectDir: string, args: Record<string, unknown>): Promise<unknown> {
  const runId = text('runId', args, 64);
  const nodeId = text('nodeId', args, 40);
  const decision = oneOf('decision', args, ['approve', 'reject'] as const);
  const note = optionalText('note', args, MAX_NOTE);
  return change(projectDir, runId, (s) => approveNode(s, nodeId, decision), note === undefined ? {} : { note });
}

async function next(projectDir: string, args: Record<string, unknown>): Promise<unknown> {
  const runId = text('runId', args, 64);
  // Lock first, then the state: a holder writes state.json before releasing,
  // so a state read after a free lock includes every finished call.
  await assertNotBusy(runDir(projectDir, runId), runId);
  return view(projectDir, await readState(projectDir, runId));
}

async function status(projectDir: string, args: Record<string, unknown>): Promise<unknown> {
  const state = await readState(projectDir, text('runId', args, 64));
  const nodes = Object.fromEntries(state.graph.nodes.map((n) => [n.id, state.nodes[n.id]]));
  return { runId: state.runId, graphId: state.graphId, status: state.status, current: state.current, stopAt: state.stopAt, nodes };
}

async function list(projectDir: string): Promise<unknown> {
  const { graphs, invalid } = await loadUserGraphs(projectDir);
  const builtins = builtinGraphs().map((g) => ({ id: g.id, nodes: g.nodes.length, source: 'built-in' }));
  return { graphs: [...builtins, ...graphs.map(({ graph, file }) => ({ id: graph.id, nodes: graph.nodes.length, source: `.toto/graphs/${file}` }))], invalid };
}

function template(args: Record<string, unknown>): unknown {
  const kind = args['kind'];
  if (!isTemplateKind(kind)) throw new RpcError(INVALID_PARAMS, `kind must be one of: ${TEMPLATE_KINDS.join(', ')}`);
  return { kind, markdown: templateFor(kind) };
}

// JSON text result; GraphError -> { error: { code, message } } with isError.
function graphTool(name: string, run: (args: Record<string, unknown>) => unknown): Tool {
  const definition = GRAPH_DEFINITIONS.find((d) => d.name === name);
  assert.ok(definition !== undefined, `tool ${name} has a definition`);
  return {
    definition,
    handler: async (args: Record<string, unknown>): Promise<Message> => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await run(args)) }] };
      } catch (err) {
        if (!(err instanceof GraphError)) throw err;
        return { content: [{ type: 'text', text: JSON.stringify({ error: { code: err.code, message: err.message } }) }], isError: true };
      }
    },
  };
}

/** The graph tools; `projectDir` is resolved per call (Arbiter condition 8). */
export function createGraphTools(projectDir: () => string): Tool[] {
  const tools = [
    graphTool('graph_list', () => list(projectDir())),
    graphTool('graph_template', template),
    graphTool('graph_start', (args) => start(projectDir(), args)),
    graphTool('graph_next', (args) => next(projectDir(), args)),
    graphTool('graph_report', (args) => report(projectDir(), args)),
    graphTool('graph_approve', (args) => approve(projectDir(), args)),
    graphTool('graph_status', (args) => status(projectDir(), args)),
    graphTool('graph_resume', (args) => {
      const stopAt = optionalText('stopAt', args, 40);
      return change(projectDir(), text('runId', args, 64), (s) => resumeRun(s, stopAt), {});
    }),
  ];
  assert.equal(tools.length, GRAPH_DEFINITIONS.length, 'every graph definition has a tool');
  return tools;
}
