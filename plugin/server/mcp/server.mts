// The MCP request layer: built-in methods plus a fixed tool registry.
// createServer validates the tools once and returns a line handler.
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  INVALID_REQUEST,
  RpcError,
  SUPPORTED_PROTOCOL_VERSIONS,
  decodeJson,
  errorResponse,
  isRecord,
  readableId,
  successResponse,
  truncateUtf8,
  validateRequest,
} from './protocol.mts';
import type { Id, Message, Request } from './protocol.mts';

export const SERVER_NAME = 'toto-wolff';
export const SERVER_VERSION = '2.0.0-dev.1';
export const MAX_TOOLS = 64;
export const MAX_RESULT_BYTES = 1024 * 1024;
export const MAX_BATCH = 64;
// JSON-RPC batches exist only in MCP 2025-03-26 (added there, removed in 2025-06-18).
export const BATCH_PROTOCOL_VERSIONS: readonly string[] = ['2025-03-26'];
const TOOL_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Message | Promise<Message>;
}

type Method = (params: unknown) => Promise<Message>;

// Per-connection state: the protocol version agreed in initialize.
interface Session {
  version: string | null;
}
export type Reply = Message | Message[];
export type LineHandler = (line: string) => Promise<Reply | null>;

// Throws at startup on a bad registry: too many tools, a bad or duplicate name.
function buildRegistry(tools: readonly Tool[]): ReadonlyMap<string, Tool> {
  assert.ok(tools.length <= MAX_TOOLS, `at most ${String(MAX_TOOLS)} tools`);
  const registry = new Map<string, Tool>();
  // Bound: tools.length <= MAX_TOOLS (asserted above).
  for (const tool of tools) {
    const name = tool.definition.name;
    assert.ok(TOOL_NAME_PATTERN.test(name), `invalid tool name: ${name}`);
    assert.ok(!registry.has(name), `duplicate tool name: ${name}`);
    registry.set(name, tool);
  }
  assert.equal(registry.size, tools.length, 'every tool is registered once');
  return registry;
}

function initialize(params: unknown, session: Session): Message {
  if (!isRecord(params) || typeof params.protocolVersion !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'initialize needs a protocolVersion string');
  }
  const requested = params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion), 'the answered version is supported');
  session.version = protocolVersion;
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
}

function toolArguments(params: Record<string, unknown>): Record<string, unknown> {
  const args = params.arguments;
  if (args === undefined) return {};
  if (!isRecord(args)) throw new RpcError(INVALID_PARAMS, 'tool arguments must be an object');
  assert.ok(isRecord(args), 'arguments narrowed to an object');
  return args;
}

// Runs one tool. Its own RpcErrors pass through; anything else is logged by
// tool name only (never its arguments) and becomes INTERNAL_ERROR.
async function callTool(registry: ReadonlyMap<string, Tool>, params: unknown): Promise<Message> {
  if (!isRecord(params) || typeof params.name !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'tools/call needs a tool name');
  }
  const tool = registry.get(params.name);
  if (tool === undefined) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${truncateUtf8(params.name, 64)}`);
  const args = toolArguments(params);
  let result: unknown;
  try {
    result = await tool.handler(args);
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const kind = err instanceof Error ? err.name : typeof err;
    process.stderr.write(`toto-wolff: tool ${tool.definition.name} failed (${kind})\n`);
    throw new RpcError(INTERNAL_ERROR, 'Internal error');
  }
  return checkedResult(tool.definition.name, result);
}

function checkedResult(name: string, result: unknown): Message {
  assert.ok(name.length > 0, 'a tool has a name');
  if (!isRecord(result)) {
    process.stderr.write(`toto-wolff: tool ${name} returned a non-object result\n`);
    throw new RpcError(INTERNAL_ERROR, 'Internal error');
  }
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > MAX_RESULT_BYTES) {
    throw new RpcError(INTERNAL_ERROR, `Tool result exceeds ${String(MAX_RESULT_BYTES)} bytes`);
  }
  return result;
}

function buildMethods(registry: ReadonlyMap<string, Tool>, session: Session): ReadonlyMap<string, Method> {
  const definitions = [...registry.values()].map((tool) => tool.definition);
  assert.equal(definitions.length, registry.size, 'tools/list covers every tool');
  const methods = new Map<string, Method>([
    ['initialize', (params): Promise<Message> => Promise.resolve(initialize(params, session))],
    ['ping', (): Promise<Message> => Promise.resolve({})],
    ['tools/list', (): Promise<Message> => Promise.resolve({ tools: definitions })],
    ['tools/call', (params): Promise<Message> => callTool(registry, params)],
  ]);
  assert.equal(methods.size, 4, 'four built-in methods');
  return methods;
}

async function dispatch(methods: ReadonlyMap<string, Method>, request: Request): Promise<Message> {
  const id: Id = request.id;
  const method = methods.get(request.method);
  if (method === undefined) return errorResponse(id, METHOD_NOT_FOUND, 'Method not found');
  try {
    return successResponse(id, await method(request.params));
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(id, err.code, err.message);
    process.stderr.write(`toto-wolff: ${request.method} failed\n`);
    return errorResponse(id, INTERNAL_ERROR, 'Internal error');
  }
}

// Answers one decoded request object; null for a notification.
async function handleOne(methods: ReadonlyMap<string, Method>, value: unknown, inBatch: boolean): Promise<Message | null> {
  const parsed = validateRequest(value);
  if (!parsed.ok) return errorResponse(parsed.id, parsed.error.code, parsed.error.message);
  const request = parsed.request;
  if (!request.hasId) return null;
  if (inBatch && request.method === 'initialize') {
    return errorResponse(request.id, INVALID_REQUEST, 'initialize must not be part of a batch');
  }
  return dispatch(methods, request);
}

// One error per request in a refused batch, under each request's own id;
// notifications (objects without an id) get nothing, as JSON-RPC requires.
function refuseEach(batch: unknown[], message: string): Message[] | null {
  assert.ok(batch.length > 0, 'a refused batch is not empty');
  const replies: Message[] = [];
  // Bound: batch.length entries, and the line holding the batch is capped at 1 MiB.
  for (const item of batch) {
    if (!isRecord(item) || Object.hasOwn(item, 'id')) replies.push(errorResponse(readableId(item), INVALID_REQUEST, message));
  }
  assert.ok(replies.length <= batch.length, 'at most one reply per batch entry');
  return replies.length > 0 ? replies : null;
}

// Answers a JSON-RPC batch in order; null when it held only notifications.
async function handleBatch(methods: ReadonlyMap<string, Method>, batch: unknown[], session: Session): Promise<Reply | null> {
  if (session.version === null || !BATCH_PROTOCOL_VERSIONS.includes(session.version)) {
    return errorResponse(null, INVALID_REQUEST, `Batch requests are not supported in protocol version ${session.version ?? '(not initialized)'}`);
  }
  if (batch.length === 0) return errorResponse(null, INVALID_REQUEST, 'Empty batch');
  if (batch.length > MAX_BATCH) return refuseEach(batch, `Batch exceeds ${String(MAX_BATCH)} requests`);
  const replies: Message[] = [];
  // Bound: batch.length <= MAX_BATCH (checked above).
  for (const item of batch) {
    const reply = await handleOne(methods, item, true);
    if (reply !== null) replies.push(reply);
  }
  assert.ok(replies.length <= batch.length, 'at most one reply per batch entry');
  return replies.length > 0 ? replies : null;
}

// Returns the handler for input lines. A null result means no reply is owed.
export function createServer(tools: readonly Tool[]): LineHandler {
  const session: Session = { version: null };
  const methods = buildMethods(buildRegistry(tools), session);
  assert.ok(methods.has('tools/call'), 'tools/call is always available');
  return async (line: string): Promise<Reply | null> => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (text.trim() === '') return null;
    let value: unknown;
    try {
      value = decodeJson(text);
    } catch (err) {
      if (err instanceof RpcError) return errorResponse(null, err.code, err.message);
      throw err;
    }
    return Array.isArray(value) ? handleBatch(methods, value, session) : handleOne(methods, value, false);
  };
}
