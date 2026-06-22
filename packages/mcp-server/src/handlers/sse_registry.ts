import { isAbsolute } from 'node:path';
import assert from 'node:assert';
import type { ServerResponse } from 'node:http';
import { handleDashboardStatus } from './dashboard_status.js';
import type { DashboardStats } from './dashboard_status.js';

const MAX_CLIENTS = 50;

const clients = new Set<ServerResponse>();
let statsHandle: NodeJS.Timeout | null = null;
let keepAliveHandle: NodeJS.Timeout | null = null;

/**
 * Serializes a stats snapshot to the DashboardStats SSE payload.
 * Separate from broadcastStats so errors here surface cleanly.
 */
function buildStatsPayload(vaultPath: string): Promise<DashboardStats> {
  assert(isAbsolute(vaultPath), 'buildStatsPayload: vaultPath must be absolute');
  return handleDashboardStatus(vaultPath).then((data) => ({
    councilCount: data.councilSessions.count,
    p10Count: data.p10Plans.count,
    blockedCount: data.blockedItems.length,
    generatedAt: data.generatedAt,
  }));
}

/**
 * Writes a single SSE frame to one client.
 * Checks res.destroyed before write. On backpressure (write returns false), removes client.
 * Must never throw — a dead socket must not abort the broadcast loop.
 */
function writeSseToClient(client: ServerResponse, event: string, data: string): void {
  assert(typeof event === 'string' && event.length > 0, 'writeSseToClient: event must be non-empty string');
  assert(typeof data === 'string', 'writeSseToClient: data must be a string');
  if (client.destroyed) {
    unregisterClient(client);
    return;
  }
  try {
    const frame = event === 'keepalive'
      ? ': keep-alive\n\n'
      : `event: ${event}\ndata: ${data}\n\n`;
    const ok = client.write(frame);
    if (!ok) unregisterClient(client);
  } catch {
    unregisterClient(client);
  }
}

/** Broadcasts current vault stats to all connected SSE clients. */
async function broadcastStats(vaultPath: string): Promise<void> {
  assert(isAbsolute(vaultPath), 'broadcastStats: vaultPath must be absolute');
  assert(clients.size <= MAX_CLIENTS, 'broadcastStats: client count exceeds cap');

  let payload: DashboardStats;
  try {
    payload = await buildStatsPayload(vaultPath);
  } catch {
    // LOOP BOUND: clients.size ≤ MAX_CLIENTS = 50
    for (const client of clients) {
      writeSseToClient(client, 'error', JSON.stringify({ message: 'vault unavailable' }));
    }
    return;
  }

  const data = JSON.stringify(payload);
  // LOOP BOUND: clients.size ≤ MAX_CLIENTS = 50
  for (const client of clients) {
    writeSseToClient(client, 'stats', data);
  }
}

/** Sends keep-alive comments to all clients via the same gated writer. */
function broadcastKeepAlive(): void {
  // LOOP BOUND: clients.size ≤ MAX_CLIENTS = 50
  for (const client of clients) {
    writeSseToClient(client, 'keepalive', '');
  }
}

/** Returns true when the client Set is at MAX_CLIENTS capacity. */
export function isAtCapacity(): boolean {
  return clients.size >= MAX_CLIENTS;
}

/** Removes a client from the registry and tears down intervals when last client leaves. */
export function unregisterClient(res: ServerResponse): void {
  assert(res !== null, 'unregisterClient: res must not be null');
  clients.delete(res);
  console.error(`[SSE] client disconnected — total: ${clients.size}`);
  if (clients.size === 0) {
    assert(clients.size === 0, 'unregisterClient: teardown invariant — clients must be empty');
    clearInterval(statsHandle!);
    clearInterval(keepAliveHandle!);
    statsHandle = null;
    keepAliveHandle = null;
  }
}

/**
 * Registers a new SSE client. Starts broadcast intervals on first connection.
 * Caller must check isAtCapacity() before calling — capacity is enforced at the
 * HTTP handler layer (handleSseRequest) so headers are not yet sent here.
 */
export function registerClient(res: ServerResponse, vaultPath: string): void {
  assert(typeof res === 'object' && res !== null, 'registerClient: res must be a ServerResponse');
  assert(isAbsolute(vaultPath), 'registerClient: vaultPath must be absolute');
  assert(!isAtCapacity(), 'registerClient: called at capacity — check isAtCapacity() first');

  if (res.destroyed) return;

  clients.add(res);
  assert(clients.size <= MAX_CLIENTS, 'registerClient: clients exceeded MAX_CLIENTS after add');
  console.error(`[SSE] client connected — total: ${clients.size}`);

  res.on('close', () => unregisterClient(res));

  if (clients.size === 1) {
    assert(statsHandle === null, 'registerClient: statsHandle must be null before first client');
    assert(keepAliveHandle === null, 'registerClient: keepAliveHandle must be null before first client');
    statsHandle = setInterval(() => void broadcastStats(vaultPath), 15_000);
    keepAliveHandle = setInterval(() => broadcastKeepAlive(), 10_000);
  }
}
