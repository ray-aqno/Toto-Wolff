import { isAbsolute } from 'node:path';
import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { registerClient, isAtCapacity } from './sse_registry.js';

/**
 * Handles GET /dashboard/events — sets SSE headers and registers the client
 * with the shared broadcast registry.
 * Capacity check runs BEFORE writeHead(200) to ensure a clean 503 can be sent.
 * Sends an initial connected event so the browser EventSource knows the stream is live.
 */
export function handleSseRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
): void {
  assert(isAbsolute(vaultPath), 'handleSseRequest: vaultPath must be absolute');
  assert(!res.destroyed, 'handleSseRequest: response already destroyed on entry');

  if (isAtCapacity()) {
    res.writeHead(503, { 'Content-Type': 'text/plain' }).end('SSE: server at capacity');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (!res.destroyed) {
    res.write('event: connected\ndata: {}\n\n');
  }

  registerClient(res, vaultPath);
}
