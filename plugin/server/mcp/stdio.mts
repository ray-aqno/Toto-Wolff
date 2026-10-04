// Newline-delimited JSON-RPC over stdio. This is the only module that writes
// stdout; everything else logs to stderr.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import process from 'node:process';
import { INTERNAL_ERROR, INVALID_REQUEST, PARSE_ERROR, errorResponse } from './protocol.mts';
import type { Message } from './protocol.mts';
import type { LineHandler } from './server.mts';

export const MAX_LINE_BYTES = 1024 * 1024;
const NEWLINE_BYTE = 0x0a;

export type LineEvent = { kind: 'line'; text: string } | { kind: 'oversized' } | { kind: 'invalid-utf8' };

// MCP messages are UTF-8: malformed bytes are rejected, never replaced with U+FFFD.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

function decodeLine(bytes: Buffer): LineEvent {
  assert.ok(bytes.length <= MAX_LINE_BYTES, 'a complete line is within the cap');
  try {
    return { kind: 'line', text: STRICT_UTF8.decode(bytes) };
  } catch {
    return { kind: 'invalid-utf8' };
  }
}

// Splits a byte stream into lines. Bytes are joined before decoding, so a
// character split across chunks survives. A line over MAX_LINE_BYTES yields one
// 'oversized' event, then its remaining bytes are discarded up to the newline.
export async function* readLines(input: AsyncIterable<Buffer | string>): AsyncGenerator<LineEvent> {
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
      if (!discarding) yield decodeLine(Buffer.concat(pending, pendingBytes));
      pending.length = 0;
      pendingBytes = 0;
      discarding = false;
      start = newline + 1;
    }
    assert.ok(pendingBytes <= MAX_LINE_BYTES, 'buffered bytes stay under the line cap');
  }
  if (!discarding && pendingBytes > 0) yield decodeLine(Buffer.concat(pending, pendingBytes));
}

export async function writeMessage(message: Message): Promise<void> {
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

// Serves requests from stdin until it ends, answering each through writeMessage.
export async function runStdio(handle: LineHandler): Promise<void> {
  assert.equal(typeof handle, 'function', 'a line handler is required');
  process.stdout.on('error', (err: Error) => {
    process.stderr.write(`toto-wolff: stdout closed: ${err.message}\n`);
    process.exitCode = 1;
    process.stdin.destroy();
  });
  process.stdin.on('error', (err: Error) => {
    process.stderr.write(`toto-wolff: stdin failed: ${err.message}\n`);
    process.exitCode = 1;
  });
  const oversized = errorResponse(null, INVALID_REQUEST, `Message exceeds ${String(MAX_LINE_BYTES)} bytes`);
  const badUtf8 = errorResponse(null, PARSE_ERROR, 'Parse error: message is not valid UTF-8');
  assert.equal(oversized.jsonrpc, '2.0', 'the oversized reply is JSON-RPC 2.0');
  for await (const event of readLines(process.stdin)) {
    let response: Message | null;
    if (event.kind === 'oversized') response = oversized;
    else if (event.kind === 'invalid-utf8') response = badUtf8;
    else response = await handle(event.text);
    if (response !== null) await writeMessage(response);
  }
}
