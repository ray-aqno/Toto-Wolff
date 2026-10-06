// The MCP request layer: built-in methods plus a fixed tool registry, served
// in two eras. A request whose params._meta carries the 2026-07-28 keys is
// served statelessly (mcp/modern.mts); every other request gets the 2025-11-25
// handshake behavior. createServer validates the tools once and returns a line
// handler; it keeps no state between requests.
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
  successResponse,
  truncateUtf8,
  validateRequest,
} from './protocol.mts';
import type { Id, Message, Request } from './protocol.mts';
import { checkMeta, discoverResult, isModern, toolsListResult, withComplete } from './modern.mts';
import type { ServerInfo } from './modern.mts';

export const SERVER_NAME = 'toto-wolff';
export const SERVER_VERSION = '2.0.0';
export const MAX_TOOLS = 64;
export const MAX_RESULT_BYTES = 1024 * 1024;
const SERVER_INFO: ServerInfo = Object.freeze({ name: SERVER_NAME, version: SERVER_VERSION });

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
interface Eras {
  legacy: ReadonlyMap<string, Method>;
  modern: ReadonlyMap<string, Method>;
}
export type LineHandler = (line: string) => Promise<Message | null>;

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

function initialize(params: unknown): Message {
  if (!isRecord(params) || typeof params.protocolVersion !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'initialize needs a protocolVersion string');
  }
  const requested = params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion), 'the answered version is supported');
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
  return enforceResultCap(result);
}

function enforceResultCap(result: Message): Message {
  assert.ok(isRecord(result), 'a capped result is an object');
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > MAX_RESULT_BYTES) {
    throw new RpcError(INTERNAL_ERROR, `Tool result exceeds ${String(MAX_RESULT_BYTES)} bytes`);
  }
  return result;
}

function buildMethods(registry: ReadonlyMap<string, Tool>): ReadonlyMap<string, Method> {
  const definitions = [...registry.values()].map((tool) => tool.definition);
  assert.equal(definitions.length, registry.size, 'tools/list covers every tool');
  const methods = new Map<string, Method>([
    ['initialize', (params): Promise<Message> => Promise.resolve(initialize(params))],
    ['ping', (): Promise<Message> => Promise.resolve({})],
    ['tools/list', (): Promise<Message> => Promise.resolve({ tools: definitions })],
    ['tools/call', (params): Promise<Message> => callTool(registry, params)],
  ]);
  assert.equal(methods.size, 4, 'four built-in methods');
  return methods;
}

// The 2026-07-28 methods: no initialize and no ping (both answer -32601).
function buildModernMethods(registry: ReadonlyMap<string, Tool>): ReadonlyMap<string, Method> {
  const definitions = [...registry.values()].map((tool) => tool.definition);
  assert.equal(definitions.length, registry.size, 'tools/list covers every tool');
  const methods = new Map<string, Method>([
    ['server/discover', (): Promise<Message> => Promise.resolve(discoverResult(SERVER_INFO))],
    ['tools/list', (params): Promise<Message> => Promise.resolve(toolsListResult(definitions, params, SERVER_INFO))],
    ['tools/call', async (params): Promise<Message> => enforceResultCap(withComplete(await callTool(registry, params), SERVER_INFO))],
  ]);
  assert.equal(methods.size, 3, 'three modern methods');
  return methods;
}

async function dispatch(methods: ReadonlyMap<string, Method>, request: Request): Promise<Message> {
  const id: Id = request.id;
  const method = methods.get(request.method);
  if (method === undefined) return errorResponse(id, METHOD_NOT_FOUND, 'Method not found');
  try {
    return successResponse(id, await method(request.params));
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(id, err.code, err.message, err.data);
    process.stderr.write(`toto-wolff: ${request.method} failed\n`);
    return errorResponse(id, INTERNAL_ERROR, 'Internal error');
  }
}

// A modern request: ids may not be null, and _meta must be complete and name a
// served version, before the request reaches its method.
async function serveModern(methods: ReadonlyMap<string, Method>, request: Request): Promise<Message> {
  assert.ok(request.hasId, 'notifications never reach serveModern');
  if (request.id === null) return errorResponse(null, INVALID_REQUEST, 'Request id must not be null');
  try {
    checkMeta(request.params);
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(request.id, err.code, err.message, err.data);
    throw err;
  }
  return dispatch(methods, request);
}

// Answers one decoded request object; null for a notification (either era).
async function handleOne(eras: Eras, value: unknown): Promise<Message | null> {
  const parsed = validateRequest(value);
  if (!parsed.ok) return errorResponse(parsed.id, parsed.error.code, parsed.error.message);
  const request = parsed.request;
  if (!request.hasId) return null;
  return isModern(request.params) ? serveModern(eras.modern, request) : dispatch(eras.legacy, request);
}

// Returns the handler for input lines. A null result means no reply is owed.
export function createServer(tools: readonly Tool[]): LineHandler {
  const registry = buildRegistry(tools);
  const eras: Eras = { legacy: buildMethods(registry), modern: buildModernMethods(registry) };
  assert.ok(eras.legacy.has('tools/call') && eras.modern.has('tools/call'), 'tools/call is served in both eras');
  return async (line: string): Promise<Message | null> => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (text.trim() === '') return null;
    let value: unknown;
    try {
      value = decodeJson(text);
    } catch (err) {
      if (err instanceof RpcError) return errorResponse(null, err.code, err.message);
      throw err;
    }
    if (Array.isArray(value)) return errorResponse(null, INVALID_REQUEST, 'Batch requests are not supported');
    return handleOne(eras, value);
  };
}
