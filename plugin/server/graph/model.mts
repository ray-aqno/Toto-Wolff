// The graph model (2.0 spec, "Graph model (#3)"): a DAG of nodes, loops being
// a node kind, never graph cycles. Every client-facing failure is a
// GraphError carrying one of the spec's error codes.
import assert from 'node:assert/strict';

export const MAX_NODES = 64;
export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const MAX_INSTRUCTION_CHARS = 4096;
export const MAX_SKILL_CHARS = 200;
export const MIN_ITERATIONS = 1;
export const MAX_ITERATIONS = 10;
export const DEFAULT_ITERATIONS = 3;

export const NODE_KINDS = ['skill', 'choice', 'loop', 'human_gate'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface GraphNode {
  id: string;
  kind: NodeKind;
  skill?: string;
  instruction: string;
  // 'choice' only: option name -> node ids enabled by it. Built with
  // Object.create(null), so a key such as "constructor" is never inherited.
  options?: Record<string, string[]>;
  maxIterations?: number;
}

export interface Graph {
  id: string;
  version: 1;
  nodes: GraphNode[];
  edges: [string, string][];
}

// Exhaustive (spec). DOC_EXISTS and BAD_EVIDENCE are #63's; NODE_TOO_OLD is
// the Node version gate in version.mts.
export type ErrorCode =
  | 'UNKNOWN_GRAPH'
  | 'UNKNOWN_RUN'
  | 'UNKNOWN_NODE'
  | 'INVALID_GRAPH'
  | 'INVALID_CHOICE'
  | 'RUN_BUSY'
  | 'STALE_STEP'
  | 'NOT_A_GATE'
  | 'RUN_FINISHED'
  | 'DOC_EXISTS'
  | 'BAD_EVIDENCE'
  | 'NODE_TOO_OLD';

/** A client-facing graph failure: returned as `{ error: { code, message } }`. */
export class GraphError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    assert.ok(message.length > 0, 'a graph error has a message');
    super(message);
    this.name = 'GraphError';
    this.code = code;
    assert.equal(this.code, code, 'the code is kept');
  }
}

/** Own-property lookup on a dictionary, so inherited keys never match. */
export function hasKey(record: object, key: string): boolean {
  assert.ok(typeof key === 'string', 'a key is a string');
  assert.ok(record !== null, 'the record exists');
  return Object.hasOwn(record, key);
}
