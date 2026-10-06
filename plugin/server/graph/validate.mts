// Graph validation: parseGraph turns unknown JSON into a Graph or throws
// INVALID_GRAPH with a message naming the problem (the cycle, the unknown
// endpoint, the node count). No recursion: the DAG check is Kahn's algorithm.
import assert from 'node:assert/strict';
import { isRecord } from '../mcp/protocol.mts';
import {
  DEFAULT_ITERATIONS,
  GraphError,
  ID_PATTERN,
  MAX_INSTRUCTION_CHARS,
  MAX_ITERATIONS,
  MAX_NODES,
  MAX_SKILL_CHARS,
  MIN_ITERATIONS,
  NODE_CHECKS,
  NODE_KINDS,
  hasKey,
} from './model.mts';
import type { Graph, GraphNode, NodeCheck, NodeKind } from './model.mts';

const MAX_EDGES = MAX_NODES * (MAX_NODES - 1);

function invalid(message: string): GraphError {
  return new GraphError('INVALID_GRAPH', message);
}

function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && (NODE_KINDS as readonly string[]).includes(value);
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw invalid(`${what} must match ${ID_PATTERN.source}`);
  }
  assert.ok(value.length <= 40, 'an id is at most 40 characters');
  return value;
}

// 'choice' options: option name -> node ids, as a prototype-free dictionary.
function parseOptions(raw: unknown, nodeId: string): Record<string, string[]> {
  if (!isRecord(raw) || Array.isArray(raw)) throw invalid(`node ${nodeId}: a choice needs an options object`);
  const options: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const keys = Object.keys(raw);
  if (keys.length === 0) throw invalid(`node ${nodeId}: a choice needs at least one option`);
  // LOOP BOUND: option keys of one node; each list is checked against MAX_NODES.
  for (const name of keys) {
    requireId(name, `node ${nodeId}: option name "${name.slice(0, 40)}"`);
    const ids = raw[name];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_NODES) {
      throw invalid(`node ${nodeId}: option ${name} must list 1 to ${String(MAX_NODES)} node ids`);
    }
    options[name] = ids.map((id) => requireId(id, `node ${nodeId}: option ${name} entry`));
  }
  assert.equal(Object.keys(options).length, keys.length, 'every option is kept');
  return options;
}

// The optional evidence check: skill nodes only, one of NODE_CHECKS.
function parseCheck(raw: unknown, id: string, kind: NodeKind): NodeCheck | undefined {
  if (raw === undefined) return undefined;
  if (kind !== 'skill') throw invalid(`node ${id}: only skill nodes take a check`);
  const found = NODE_CHECKS.find((c) => c === raw);
  if (found === undefined) throw invalid(`node ${id}: check must be one of ${NODE_CHECKS.join(', ')}`);
  assert.ok(NODE_CHECKS.includes(found), 'a known check');
  return found;
}

function parseNodeFields(raw: Record<string, unknown>, id: string, kind: NodeKind): GraphNode {
  if (typeof raw.instruction !== 'string' || raw.instruction.length === 0 || raw.instruction.length > MAX_INSTRUCTION_CHARS) {
    throw invalid(`node ${id}: instruction must be 1 to ${String(MAX_INSTRUCTION_CHARS)} characters`);
  }
  const node: GraphNode = { id, kind, instruction: raw.instruction };
  const needsSkill = kind === 'skill' || kind === 'loop';
  if (needsSkill) {
    if (typeof raw.skill !== 'string' || raw.skill.length === 0 || raw.skill.length > MAX_SKILL_CHARS) {
      throw invalid(`node ${id}: a ${kind} node needs a skill (1 to ${String(MAX_SKILL_CHARS)} characters)`);
    }
    node.skill = raw.skill;
  } else if (raw.skill !== undefined) throw invalid(`node ${id}: only skill and loop nodes take a skill`);
  if (kind === 'choice') node.options = parseOptions(raw.options, id);
  else if (raw.options !== undefined) throw invalid(`node ${id}: only choice nodes take options`);
  if (kind === 'loop') {
    const n = raw.maxIterations ?? DEFAULT_ITERATIONS;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
      throw invalid(`node ${id}: maxIterations must be an integer from ${String(MIN_ITERATIONS)} to ${String(MAX_ITERATIONS)}`);
    }
    node.maxIterations = n;
  } else if (raw.maxIterations !== undefined) throw invalid(`node ${id}: only loop nodes take maxIterations`);
  const check = parseCheck(raw.check, id, kind);
  if (check !== undefined) node.check = check;
  assert.equal(node.id, id, 'the node keeps its id');
  return node;
}

function parseNodes(raw: unknown): GraphNode[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('nodes must be a non-empty array');
  if (raw.length > MAX_NODES) throw invalid(`graph has ${String(raw.length)} nodes; the limit is ${String(MAX_NODES)}`);
  const seen = new Set<string>();
  // LOOP BOUND: at most MAX_NODES nodes (checked above).
  const nodes = raw.map((entry: unknown, i): GraphNode => {
    if (!isRecord(entry) || Array.isArray(entry)) throw invalid(`nodes[${String(i)}] must be an object`);
    const id = requireId(entry.id, `nodes[${String(i)}].id`);
    if (seen.has(id)) throw invalid(`duplicate node id ${id}`);
    seen.add(id);
    if (!isNodeKind(entry.kind)) throw invalid(`node ${id}: kind must be one of ${NODE_KINDS.join(', ')}`);
    return parseNodeFields(entry, id, entry.kind);
  });
  assert.ok(nodes.length >= 1 && nodes.length <= MAX_NODES, 'the node count is in range');
  return nodes;
}

function parseEdges(raw: unknown, ids: ReadonlySet<string>): [string, string][] {
  if (!Array.isArray(raw)) throw invalid('edges must be an array');
  if (raw.length > MAX_EDGES) throw invalid(`graph has ${String(raw.length)} edges; the limit is ${String(MAX_EDGES)}`);
  const seen = new Set<string>();
  // LOOP BOUND: at most MAX_EDGES edges (checked above).
  const edges = raw.map((entry: unknown, i): [string, string] => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      throw invalid(`edges[${String(i)}] must be a [from, to] pair of node ids`);
    }
    const [from, to] = entry as [string, string];
    for (const end of [from, to]) {
      if (!ids.has(end)) throw invalid(`edge ${from.slice(0, 40)} -> ${to.slice(0, 40)}: unknown node ${end.slice(0, 40)}`);
    }
    if (from === to) throw invalid(`edge ${from} -> ${to}: a node cannot lead to itself`);
    const name = `${from}\n${to}`;
    if (seen.has(name)) throw invalid(`duplicate edge ${from} -> ${to}`);
    seen.add(name);
    return [from, to];
  });
  assert.equal(edges.length, raw.length, 'every edge is kept');
  return edges;
}

/** Predecessor lists per node id, in edge order. */
export function predecessors(graph: Pick<Graph, 'nodes' | 'edges'>): Map<string, string[]> {
  const preds = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  // LOOP BOUND: at most MAX_EDGES edges.
  for (const [from, to] of graph.edges) {
    const list = preds.get(to);
    assert.ok(list !== undefined, 'every edge endpoint is a node');
    list.push(from);
  }
  assert.equal(preds.size, graph.nodes.length, 'every node has a predecessor list');
  return preds;
}

// Names one cycle among the nodes Kahn's algorithm could not order. Each of
// them has a predecessor that is also unordered, so walking predecessors
// must repeat a node within MAX_NODES steps; the repeated stretch is a cycle,
// named from its member listed first in `nodes`.
function nameCycle(left: ReadonlySet<string>, preds: ReadonlyMap<string, string[]>): string {
  const first = left.values().next().value;
  assert.ok(first !== undefined, 'a cycle leaves nodes unordered');
  const path: string[] = [first];
  // LOOP BOUND: at most MAX_NODES + 1 steps (a node repeats by then).
  for (let i = 0; i <= MAX_NODES; i++) {
    const current = path[path.length - 1] ?? first;
    const back = (preds.get(current) ?? []).find((p) => left.has(p));
    assert.ok(back !== undefined, 'an unordered node has an unordered predecessor');
    const at = path.indexOf(back);
    if (at !== -1) {
      const cycle = path.slice(at).reverse();
      // Start at the member listed first in `nodes` (`left` keeps that order).
      const head = [...left].find((id) => cycle.includes(id)) ?? back;
      const k = cycle.indexOf(head);
      const rotated = [...cycle.slice(k), ...cycle.slice(0, k)];
      return `cycle: ${[...rotated, head].join(' -> ')}`;
    }
    path.push(back);
  }
  throw new Error('cycle walk did not close');
}

function checkAcyclic(graph: Pick<Graph, 'nodes' | 'edges'>, preds: ReadonlyMap<string, string[]>): void {
  const inDegree = new Map<string, number>(graph.nodes.map((n) => [n.id, preds.get(n.id)?.length ?? 0]));
  const ready = graph.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const ordered = new Set<string>();
  // LOOP BOUND: each node enters `ready` at most once (at most MAX_NODES).
  while (ready.length > 0) {
    const id = ready.pop();
    assert.ok(id !== undefined, 'ready is non-empty');
    ordered.add(id);
    // LOOP BOUND: at most MAX_EDGES edges per pass.
    for (const [from, to] of graph.edges) {
      if (from !== id) continue;
      const d = (inDegree.get(to) ?? 0) - 1;
      inDegree.set(to, d);
      if (d === 0) ready.push(to);
    }
  }
  if (ordered.size === graph.nodes.length) return;
  const left = new Set(graph.nodes.map((n) => n.id).filter((id) => !ordered.has(id)));
  throw invalid(nameCycle(left, preds));
}

function checkStart(graph: Graph, preds: ReadonlyMap<string, string[]>): void {
  const starts = graph.nodes.filter((n) => (preds.get(n.id) ?? []).length === 0).map((n) => n.id);
  assert.ok(starts.length >= 1, 'an acyclic graph has a start node');
  if (starts.length !== 1) throw invalid(`graph needs exactly one start node; found ${String(starts.length)}: ${starts.join(', ')}`);
}

// Each option lists direct successors of its choice; a node is in at most one
// option list; an option node's only predecessor is its choice (Arbiter
// condition 11), so pruning it can never strand another branch.
function checkChoices(graph: Graph, preds: ReadonlyMap<string, string[]>): void {
  const owner = new Map<string, string>();
  // LOOP BOUND: at most MAX_NODES nodes, each with option lists bounded by MAX_NODES.
  for (const node of graph.nodes) {
    if (node.options === undefined) continue;
    for (const name of Object.keys(node.options)) {
      for (const id of node.options[name] ?? []) {
        const label = `node ${node.id}: option ${name} lists ${id}`;
        if (owner.has(id)) throw invalid(`${label}, which is already in option ${owner.get(id) ?? ''}`);
        owner.set(id, `${node.id}.${name}`);
        const from = preds.get(id);
        if (from === undefined) throw invalid(`${label}: unknown node ${id}`);
        if (!from.includes(node.id)) throw invalid(`${label}, which is not a direct successor of ${node.id}`);
        if (from.length !== 1) throw invalid(`${label}, which has other predecessors (${from.filter((p) => p !== node.id).join(', ')}); an option node may only follow its choice`);
      }
    }
  }
  checkChoiceSuccessors(graph, owner);
  assert.ok(owner.size <= graph.nodes.length, 'each node has at most one option owner');
}

// Every direct successor of a choice is in one of its options (PR #69
// review): an unlisted successor would run whatever is chosen, so a missing
// option entry is a load-time error, not a branch that always runs.
function checkChoiceSuccessors(graph: Graph, owner: ReadonlyMap<string, string>): void {
  assert.ok(owner.size <= MAX_NODES, 'the owner map is bounded');
  // LOOP BOUND: at most MAX_EDGES edges.
  for (const [from, to] of graph.edges) {
    const choice = graph.nodes.find((n) => n.id === from && n.kind === 'choice');
    if (choice === undefined) continue;
    if (!(owner.get(to) ?? '').startsWith(`${from}.`)) {
      throw invalid(`node ${from}: successor ${to} is in none of its options; list it under one option, or put it after the branches join`);
    }
  }
  assert.ok(graph.edges.length <= MAX_EDGES, 'the edges are bounded');
}

/** Validates unknown JSON as a Graph, or throws GraphError INVALID_GRAPH. */
export function parseGraph(raw: unknown): Graph {
  if (!isRecord(raw) || Array.isArray(raw)) throw invalid('a graph must be a JSON object');
  const id = requireId(raw.id, 'graph id');
  if (raw.version !== 1) throw invalid(`graph ${id}: version must be 1`);
  const nodes = parseNodes(raw.nodes);
  const edges = parseEdges(raw.edges, new Set(nodes.map((n) => n.id)));
  const graph: Graph = { id, version: 1, nodes, edges };
  const preds = predecessors(graph);
  checkAcyclic(graph, preds);
  checkStart(graph, preds);
  checkChoices(graph, preds);
  assert.ok(hasKey(graph, 'nodes') && graph.nodes.length <= MAX_NODES, 'the graph is within limits');
  return graph;
}
