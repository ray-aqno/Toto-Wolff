import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SignalRecord } from '@toto-wolff/core';
import { SignalIndex } from './signal_index.js';

/** Maps a SignalRecord to the response shape returned by the endpoint. */
function toSignalResponse(record: SignalRecord): { id: string; content_hash: string; verdict: string } {
  assert(record.id.length > 0, 'id must be non-empty');
  assert(record.content_hash.length > 0, 'content_hash must be non-empty');
  return { id: record.id, content_hash: record.content_hash, verdict: record.verdict };
}

/**
 * GET /vault/signal — returns active signal records as a JSON array via SignalIndex.
 * 200+[] on empty (cold-start is a first-class state, not an error).
 * 500 only on index load failure.
 */
export async function handleVaultSignal(
  _req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
): Promise<void> {
  assert(vaultPath.length > 0, 'vaultPath must be non-empty');
  const index = new SignalIndex(vaultPath);
  try {
    await index.load();
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'vault read failed' }));
    return;
  }
  const payload = index.getAll().map(toSignalResponse);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
}
