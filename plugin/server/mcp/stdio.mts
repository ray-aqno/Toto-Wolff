// Newline-delimited JSON-RPC over stdio. This is the only module that writes
// stdout; everything else logs to stderr.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import process from 'node:process';
import { INTERNAL_ERROR, INVALID_REQUEST, errorResponse } from './protocol.mts';
import type { Message } from './protocol.mts';
import type { LineHandler } from './server.mts';

export const MAX_LINE_BYTES = 1024 * 1024;
const NEWLINE_BYTE = 0x0a;

export type LineEvent = { kind: 'line'; text: string } | { kind: 'oversized' };

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
  assert.equal(oversized.jsonrpc, '2.0', 'the oversized reply is JSON-RPC 2.0');
  for await (const event of readLines(process.stdin)) {
    const response = event.kind === 'oversized' ? oversized : await handle(event.text);
    if (response !== null) await writeMessage(response);
  }
}
