// JSON-RPC 2.0 message shapes, error codes and input guards shared by the
// MCP layer and by every tool. Nothing here touches stdio.
import assert from 'node:assert/strict';

export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

const MAX_UTF8_CONTINUATION_BYTES = 3;

export type Id = string | number | null;
export type Message = Record<string, unknown>;

export interface Request {
  hasId: boolean;
  id: Id;
  method: string;
  params: unknown;
}

export type ParseResult = { ok: true; request: Request } | { ok: false; id: Id; error: RpcError };

export class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isId(value: unknown): value is Id {
  if (value === null || typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

export function successResponse(id: Id, result: Message): Message {
  assert.ok(isId(id), 'response id must be a string, number or null');
  assert.ok(isRecord(result), 'result must be an object');
  return { jsonrpc: '2.0', id, result };
}

export function errorResponse(id: Id, code: number, message: string): Message {
  assert.ok(isId(id), 'response id must be a string, number or null');
  assert.ok(Number.isInteger(code) && code < 0, 'error codes are negative integers');
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// Cuts text to at most maxBytes of UTF-8 without splitting a character.
export function truncateUtf8(text: string, maxBytes: number): string {
  assert.ok(Number.isInteger(maxBytes) && maxBytes > 0, 'maxBytes must be a positive integer');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Bound: a UTF-8 character has at most 3 continuation bytes (0b10xxxxxx).
  for (let step = 0; step < MAX_UTF8_CONTINUATION_BYTES; step++) {
    const byte = bytes[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end--;
  }
  const cut = bytes.subarray(0, end).toString('utf8');
  assert.ok(Buffer.byteLength(cut, 'utf8') <= maxBytes, 'truncated text fits the byte limit');
  return cut;
}

// Parses one line of JSON, or throws PARSE_ERROR.
export function decodeJson(line: string): unknown {
  assert.equal(typeof line, 'string', 'a line is a string');
  try {
    return JSON.parse(line);
  } catch {
    throw new RpcError(PARSE_ERROR, 'Parse error');
  }
}

// The request id if it can be read, so even an invalid request's error can
// carry it (JSON-RPC 2.0, section 5); null otherwise.
function readableId(value: unknown): Id {
  if (!isRecord(value) || !Object.hasOwn(value, 'id')) return null;
  const rawId = value.id;
  return isId(rawId) ? rawId : null;
}

function requestShapeError(value: Record<string, unknown>): string | null {
  if (value.jsonrpc !== '2.0' || typeof value.method !== 'string') return 'Invalid request';
  if (Object.hasOwn(value, 'id') && !isId(value.id)) return 'Invalid request id';
  const params = value.params;
  if (Object.hasOwn(value, 'params') && !isRecord(params) && !Array.isArray(params)) {
    return 'params must be an object or an array';
  }
  return null;
}

// Validates one decoded JSON-RPC request object (not a batch).
export function validateRequest(value: unknown): ParseResult {
  const id = readableId(value);
  if (!isRecord(value)) return { ok: false, id, error: new RpcError(INVALID_REQUEST, 'Invalid request') };
  const problem = requestShapeError(value);
  if (problem !== null) return { ok: false, id, error: new RpcError(INVALID_REQUEST, problem) };
  const method = value.method;
  assert.equal(typeof method, 'string', 'a valid request has a method');
  const hasId = Object.hasOwn(value, 'id');
  return { ok: true, request: { hasId, id, method: String(method), params: value.params } };
}

// Decodes and validates a single (non-batch) request line.
export function parseRequest(line: string): ParseResult {
  let value: unknown;
  try {
    value = decodeJson(line);
  } catch (err) {
    if (err instanceof RpcError) return { ok: false, id: null, error: err };
    throw err;
  }
  if (Array.isArray(value)) {
    return { ok: false, id: null, error: new RpcError(INVALID_REQUEST, 'A batch is not a single request') };
  }
  return validateRequest(value);
}

// A tool-level failure: the call itself worked, but the tool reports an error.
export function toolError(text: string): Message {
  assert.equal(typeof text, 'string', 'a tool error carries text');
  const message = truncateUtf8(text.length > 0 ? text : 'Tool failed', 4096);
  assert.ok(message.length > 0, 'a tool error message is never empty');
  return { content: [{ type: 'text', text: message }], isError: true };
}

// Reads a required string argument, or rejects the call with INVALID_PARAMS.
export function requireString(args: Record<string, unknown>, key: string): string {
  assert.ok(isRecord(args), 'tool arguments are an object');
  assert.ok(key.length > 0, 'an argument key is never empty');
  const value = args[key];
  if (typeof value !== 'string') throw new RpcError(INVALID_PARAMS, `${key} must be a string`);
  return value;
}
