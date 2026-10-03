// toto-wolff 2.0 layout spike: a dependency-free MCP server over stdio.
// Node 24 runs this file directly by stripping its types, so it must use only
// erasable TypeScript and node: built-ins. Plan: vault
// P10-Plans/2026-10-03-orphan-branch-plugin-spike.md (issue #57, child #0).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import process from 'node:process';

const SERVER_NAME = 'toto-wolff';
const SERVER_VERSION = '2.0.0-spike.1';
const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_ECHO_BYTES = 1024;
const NEWLINE_BYTE = 0x0a;
const MAX_UTF8_CONTINUATION_BYTES = 3;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type Id = string | number | null;
type Message = Record<string, unknown>;
type Handler = (params: unknown) => Message;
type LineEvent = { kind: 'line'; text: string } | { kind: 'oversized' };

interface Request {
  hasId: boolean;
  id: Id;
  method: string;
  params: unknown;
}

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is Id {
  if (value === null || typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function successResponse(id: Id, result: Message): Message {
  assert.ok(isId(id), 'response id must be a string, number or null');
  assert.ok(isRecord(result), 'result must be an object');
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: Id, code: number, message: string): Message {
  assert.ok(isId(id), 'response id must be a string, number or null');
  assert.ok(Number.isInteger(code) && code < 0, 'error codes are negative integers');
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// Cuts text to at most maxBytes of UTF-8 without splitting a character.
function truncateUtf8(text: string, maxBytes: number): string {
  assert.ok(Number.isInteger(maxBytes) && maxBytes > 0, 'maxBytes must be a positive integer');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Bound: a UTF-8 character has at most 3 continuation bytes (0b10xxxxxx).
  for (let step = 0; step < MAX_UTF8_CONTINUATION_BYTES && (bytes[end] & 0xc0) === 0x80; step++) {
    end--;
  }
  const cut = bytes.subarray(0, end).toString('utf8');
  assert.ok(Buffer.byteLength(cut, 'utf8') <= maxBytes, 'truncated text fits the byte limit');
  return cut;
}

function parseRequest(line: string): Request {
  assert.equal(typeof line, 'string', 'a line is a string');
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new RpcError(PARSE_ERROR, 'Parse error');
  }
  if (Array.isArray(value)) throw new RpcError(INVALID_REQUEST, 'Batch requests are not supported');
  if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') {
    throw new RpcError(INVALID_REQUEST, 'Invalid request');
  }
  const hasId = Object.hasOwn(value, 'id');
  const rawId = value.id;
  if (hasId && !isId(rawId)) throw new RpcError(INVALID_REQUEST, 'Invalid request id');
  const id: Id = isId(rawId) ? rawId : null;
  assert.ok(hasId || id === null, 'a notification carries no id');
  return { hasId, id, method: value.method, params: value.params };
}

function handleInitialize(params: unknown): Message {
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

function handlePing(params: unknown): Message {
  assert.ok(params === undefined || isRecord(params) || Array.isArray(params), 'ping params are ignored');
  const result: Message = {};
  assert.equal(Object.keys(result).length, 0, 'ping answers with an empty object');
  return result;
}

function handleToolsList(params: unknown): Message {
  assert.ok(params === undefined || isRecord(params), 'tools/list params are an object when present');
  const tools = [
    {
      name: 'echo',
      description: 'Returns the given text, cut to at most 1024 bytes.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to send back.' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  ];
  assert.equal(tools.length, 1, 'the spike exposes exactly one tool');
  return { tools };
}

function handleToolsCall(params: unknown): Message {
  if (!isRecord(params) || typeof params.name !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'tools/call needs a tool name');
  }
  if (params.name !== 'echo') throw new RpcError(INVALID_PARAMS, `Unknown tool: ${truncateUtf8(params.name, 64)}`);
  const args = params.arguments;
  if (!isRecord(args) || typeof args.text !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'echo needs a text string');
  }
  const text = truncateUtf8(args.text, MAX_ECHO_BYTES);
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_ECHO_BYTES, 'echo output fits the limit');
  return { content: [{ type: 'text', text }] };
}

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ['initialize', handleInitialize],
  ['ping', handlePing],
  ['tools/list', handleToolsList],
  ['tools/call', handleToolsCall],
]);

// Returns the response for one input line, or null when none is owed.
function handleLine(line: string): Message | null {
  assert.equal(typeof line, 'string', 'a line is a string');
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (text.trim() === '') return null;
  let request: Request;
  try {
    request = parseRequest(text);
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(null, err.code, err.message);
    throw err;
  }
  if (!request.hasId) return null;
  const handler = HANDLERS.get(request.method);
  if (handler === undefined) return errorResponse(request.id, METHOD_NOT_FOUND, 'Method not found');
  try {
    return successResponse(request.id, handler(request.params));
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(request.id, err.code, err.message);
    process.stderr.write(`toto-wolff: ${request.method} failed: ${String(err)}\n`);
    return errorResponse(request.id, INTERNAL_ERROR, 'Internal error');
  }
}

// Splits a byte stream into lines. Bytes are joined before decoding, so a
// character split across chunks survives. A line over MAX_LINE_BYTES yields one
// 'oversized' event, then its remaining bytes are discarded up to the newline.
async function* readLines(input: AsyncIterable<Buffer | string>): AsyncGenerator<LineEvent> {
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  let discarding = false;
  // Bound: ends with the input stream; each line is capped at MAX_LINE_BYTES.
  for await (const raw of input) {
    const chunk = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
    assert.ok(Buffer.isBuffer(chunk), 'stdin yields byte chunks');
    let start = 0;
    // Bound: each pass consumes through a newline or ends, so at most chunk.length + 1 passes.
    while (start <= chunk.length) {
      const newline = chunk.indexOf(NEWLINE_BYTE, start);
      const piece = chunk.subarray(start, newline === -1 ? chunk.length : newline);
      if (!discarding && pendingBytes + piece.length > MAX_LINE_BYTES) {
        discarding = true;
        pending.length = 0;
        pendingBytes = 0;
        yield { kind: 'oversized' };
      } else if (!discarding && piece.length > 0) {
        pending.push(piece);
        pendingBytes += piece.length;
      }
      if (newline === -1) break;
      if (!discarding) yield { kind: 'line', text: Buffer.concat(pending, pendingBytes).toString('utf8') };
      pending.length = 0;
      pendingBytes = 0;
      discarding = false;
      start = newline + 1;
    }
    assert.ok(pendingBytes <= MAX_LINE_BYTES, 'buffered bytes stay under the line cap');
  }
  if (!discarding && pendingBytes > 0) yield { kind: 'line', text: Buffer.concat(pending, pendingBytes).toString('utf8') };
}

async function writeMessage(message: Message): Promise<void> {
  assert.equal(message.jsonrpc, '2.0', 'every message is JSON-RPC 2.0');
  let line: string;
  try {
    line = JSON.stringify(message);
  } catch {
    line = JSON.stringify(errorResponse(null, INTERNAL_ERROR, 'Internal error'));
  }
  assert.ok(!line.includes('\n'), 'a serialized message is one line');
  if (!process.stdout.write(`${line}\n`)) await once(process.stdout, 'drain');
}

async function main(): Promise<void> {
  assert.ok(MAX_LINE_BYTES > MAX_ECHO_BYTES, 'the line cap exceeds the echo limit');
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(LATEST_PROTOCOL_VERSION), 'the latest version is supported');
  process.stdout.on('error', (err: Error) => {
    process.stderr.write(`toto-wolff: stdout closed: ${err.message}\n`);
    process.exitCode = 1;
    process.stdin.destroy();
  });
  process.stdin.on('error', (err: Error) => {
    process.stderr.write(`toto-wolff: stdin failed: ${err.message}\n`);
    process.exitCode = 1;
  });
  for await (const event of readLines(process.stdin)) {
    const response =
      event.kind === 'oversized'
        ? errorResponse(null, INVALID_REQUEST, `Message exceeds ${MAX_LINE_BYTES} bytes`)
        : handleLine(event.text);
    if (response !== null) await writeMessage(response);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`toto-wolff: ${String(err)}\n`);
  process.exitCode = 1;
});
