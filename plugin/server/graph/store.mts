// Run files: <project>/.toto/runs/<runId>/{state.json, events.jsonl, lock}.
// This module owns every path and the lock. state.json is the one source of
// truth: written to a temp file and renamed after every transition, so a
// crash leaves the old or the new state, never a torn one. The lock is a
// pid file put in place with link(), so it is never visible empty.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';
import { INTERNAL_ERROR, RpcError, isRecord } from '../mcp/protocol.mts';
import { GraphError, hasKey } from './model.mts';
import type { GraphNode } from './model.mts';
import type { NodeRecord, NodeState, RunState, RunStatus } from './engine.mts';
import { parseGraph } from './validate.mts';
import type { ServerConfig } from '../runtime.mts';

export const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
export const MAX_STATE_BYTES = 256 * 1024;
const NODE_STATES: readonly NodeState[] = ['pending', 'done', 'skipped', 'failed'];
const RUN_STATUSES: readonly RunStatus[] = ['running', 'awaiting_approval', 'stopped_at_target', 'done', 'failed'];

/** The configured project folder when it is absolute, else the working directory (Safety Car S7). */
export function resolveProjectDir(settings: ServerConfig, cwd: string): string {
  const fromEnv = settings['project'];
  const dir = fromEnv !== undefined && isAbsolute(fromEnv) ? fromEnv : cwd;
  assert.ok(isAbsolute(dir), 'the working directory is absolute');
  assert.ok(dir.length > 0, 'the project directory is not empty');
  return dir;
}

/** The project's run folder, `<project>/.toto/runs`. */
export function runsDir(projectDir: string): string {
  assert.ok(isAbsolute(projectDir), 'the project directory is absolute');
  const dir = join(projectDir, '.toto', 'runs');
  assert.ok(dir.startsWith(projectDir), 'runs live inside the project');
  return dir;
}

/** The run's directory; a malformed id is UNKNOWN_RUN before any path is built. */
export function runDir(projectDir: string, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new GraphError('UNKNOWN_RUN', `run ${runId.slice(0, 40)} does not exist`);
  const dir = join(runsDir(projectDir), runId);
  assert.equal(relative(runsDir(projectDir), dir), runId, 'a run directory sits directly under .toto/runs');
  return dir;
}

/** When a run started, from its id (UTC, to the second). */
export function runStartMs(runId: string): number {
  assert.ok(RUN_ID_PATTERN.test(runId), 'a run id');
  const t = Date.UTC(Number(runId.slice(0, 4)), Number(runId.slice(4, 6)) - 1, Number(runId.slice(6, 8)), Number(runId.slice(9, 11)), Number(runId.slice(11, 13)), Number(runId.slice(13, 15)));
  assert.ok(Number.isFinite(t), 'a valid start time');
  return t;
}

/** YYYYMMDD-HHMMSS-<6 hex>, UTC. */
export function newRunId(now: Date): string {
  const iso = now.toISOString();
  const id = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${randomBytes(3).toString('hex')}`;
  assert.ok(RUN_ID_PATTERN.test(id), 'a new run id matches its pattern');
  return id;
}

function readable(what: string, err: unknown): RpcError {
  assert.ok(what.length > 0, 'the failure names its operation');
  const detail = isRecord(err) && typeof err.code === 'string' ? err.code : err instanceof Error ? err.message : String(err);
  return new RpcError(INTERNAL_ERROR, `toto-wolff: ${what} failed (${detail.slice(0, 200)})`);
}

/** Creates .toto/runs with its own .gitignore ("*"), so run state stays out of git. */
export async function ensureRunsDir(projectDir: string): Promise<string> {
  const dir = runsDir(projectDir);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (err) {
    if (!isRecord(err) || err.code !== 'EEXIST') throw readable('writing .toto/runs/.gitignore', err);
  }
  assert.ok(dir.endsWith(join('.toto', 'runs')), 'the runs directory');
  return dir;
}

function parseNodes(raw: unknown, graphNodes: readonly GraphNode[]): Record<string, NodeRecord> | null {
  const ids = graphNodes.map((n) => n.id);
  if (!isRecord(raw) || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== ids.length || !keys.every((k) => ids.includes(k))) return null;
  const nodes: Record<string, NodeRecord> = Object.create(null) as Record<string, NodeRecord>;
  // LOOP BOUND: one entry per graph node (at most MAX_NODES).
  for (const node of graphNodes) {
    const entry = raw[node.id];
    if (!isRecord(entry) || !(NODE_STATES as readonly unknown[]).includes(entry.state)) return null;
    const record: NodeRecord = { state: entry.state as NodeState };
    if (typeof entry.choice === 'string') record.choice = entry.choice;
    // A loop's attempt: only on loop nodes, an integer in 1..maxIterations.
    const { iteration } = entry;
    if (iteration !== undefined) {
      const max = node.kind === 'loop' ? (node.maxIterations ?? 1) : 0;
      if (typeof iteration !== 'number' || !Number.isSafeInteger(iteration) || iteration < 1 || iteration > max) return null;
      record.iteration = iteration;
    }
    nodes[node.id] = record;
  }
  assert.equal(Object.keys(nodes).length, ids.length, 'every node has a record');
  return nodes;
}

// Validates parsed state.json field by field; null when anything is off.
function parseState(raw: unknown, runId: string): RunState | null {
  if (!isRecord(raw) || raw.version !== 1 || raw.runId !== runId) return null;
  const graph = parseGraph(raw.graph);
  const ids = graph.nodes.map((n) => n.id);
  const nodes = parseNodes(raw.nodes, graph.nodes);
  const { status, current, stopAt, eventSeq, updatedAt, input } = raw;
  if (nodes === null || !(RUN_STATUSES as readonly unknown[]).includes(status)) return null;
  if (current !== null && (typeof current !== 'string' || !ids.includes(current))) return null;
  if (stopAt !== null && (typeof stopAt !== 'string' || !ids.includes(stopAt))) return null;
  if (typeof eventSeq !== 'number' || !Number.isSafeInteger(eventSeq) || eventSeq < 0 || typeof updatedAt !== 'string') return null;
  if (!isRecord(input) || typeof input.idea !== 'string' || raw.graphId !== graph.id) return null;
  const state: RunState = { version: 1, runId, graphId: graph.id, graph, input: { idea: input.idea }, stopAt, status: status as RunStatus, nodes, current, eventSeq, updatedAt };
  assert.ok(hasKey(state.nodes, ids[0] ?? ''), 'the state covers the graph');
  return state;
}

/** Reads and validates a run's state.json (capped at MAX_STATE_BYTES). */
export async function readState(projectDir: string, runId: string): Promise<RunState> {
  const file = join(runDir(projectDir, runId), 'state.json');
  let text: string;
  try {
    const size = (await stat(file)).size;
    if (size > MAX_STATE_BYTES) throw new RpcError(INTERNAL_ERROR, `toto-wolff: ${file} is ${String(size)} bytes, over the ${String(MAX_STATE_BYTES)}-byte limit`);
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof RpcError) throw err;
    if (isRecord(err) && err.code === 'ENOENT') throw new GraphError('UNKNOWN_RUN', `run ${runId} does not exist`);
    throw readable(`reading ${file}`, err);
  }
  let state: RunState | null;
  try {
    state = parseState(JSON.parse(text) as unknown, runId);
  } catch {
    state = null;
  }
  if (state === null) throw new RpcError(INTERNAL_ERROR, `toto-wolff: ${file} is not a valid run state`);
  assert.equal(state.runId, runId, 'the state belongs to this run');
  return state;
}

/** Writes state.json atomically: temp file, then rename over the old one. */
export async function writeState(projectDir: string, state: RunState): Promise<void> {
  const dir = runDir(projectDir, state.runId);
  const text = `${JSON.stringify(state, null, 2)}\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_STATE_BYTES, 'a run state stays under the read cap (S11)');
  const file = join(dir, 'state.json');
  const tmp = join(dir, `state.json.${String(process.pid)}.tmp`);
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw readable(`writing ${file}`, err);
  }
}

// True when the file is non-empty and its last byte is not a newline.
async function endsMidLine(file: string): Promise<boolean> {
  assert.ok(file.endsWith('events.jsonl'), 'only the event log is checked');
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return false;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * Appends events to events.jsonl, numbered from `firstSeq`. A failure is one
 * stderr warning: the transition already stands in state.json.
 */
export async function appendEvents(projectDir: string, runId: string, events: readonly object[], firstSeq: number, at: string): Promise<void> {
  assert.ok(Number.isSafeInteger(firstSeq) && firstSeq >= 1, 'event numbers start at 1');
  if (events.length === 0) return;
  const file = join(runDir(projectDir, runId), 'events.jsonl');
  const lines = events.map((event, i) => JSON.stringify({ seq: firstSeq + i, at, ...event })).join('\n');
  try {
    // A kill mid-append can leave a partial line; start on a fresh one (S6).
    const lead = (await endsMidLine(file)) ? '\n' : '';
    await appendFile(file, `${lead}${lines}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`toto-wolff: run ${runId}: could not append to events.jsonl (${err instanceof Error ? err.message : String(err)})\n`);
  }
}
