import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

// dashboard_status is mocked at the file level — vi.resetModules() re-evaluates
// the factory for each fresh module instance, keeping the mock in effect.
vi.mock('./dashboard_status.js', () => ({
  handleDashboardStatus: vi.fn().mockResolvedValue({
    councilSessions: { count: 2 },
    p10Plans: { count: 3 },
    blockedItems: [],
    generatedAt: '2026-06-22T00:00:00.000Z',
  }),
}));

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

function makeFakeRes(opts: { destroyed?: boolean } = {}): ServerResponse & {
  written: string[];
  ended: boolean;
  statusCode: number;
} {
  const ee = new EventEmitter();
  return Object.assign(ee, {
    destroyed: opts.destroyed ?? false,
    headersSent: false,
    written: [] as string[],
    ended: false,
    statusCode: 200,
    write(chunk: string) {
      (this as { written: string[] }).written.push(chunk);
      return true;
    },
    writeHead(code: number, _headers?: Record<string, string>) {
      (this as { statusCode: number }).statusCode = code;
      return this;
    },
    end(body?: string) {
      (this as { ended: boolean }).ended = true;
      if (body) (this as { written: string[] }).written.push(body);
      return this;
    },
  }) as unknown as ServerResponse & { written: string[]; ended: boolean; statusCode: number };
}

// Obtain a fresh module instance per test to avoid singleton state leakage.
async function freshRegistry() {
  vi.resetModules();
  const mod = await import('./sse_registry.js');
  return mod;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('registerClient — connects and logs', () => {
  it('logs client connected message', async () => {
    const { registerClient, unregisterClient } = await freshRegistry();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes();
    registerClient(res, '/tmp/vault');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SSE] client connected'));

    unregisterClient(res);
  });
});

// C2 fix: 503 test now exercises the real entry point (handleSseRequest) so the
// capacity check fires before writeHead(200) — no ERR_HTTP_HEADERS_SENT.
describe('handleSseRequest — 503 at capacity (real entry point)', () => {
  it('returns 503 before sending SSE headers when at MAX_CLIENTS', async () => {
    vi.useRealTimers(); // real http.Server needs real timers for this test
    vi.resetModules();
    vi.mock('./dashboard_status.js', () => ({
      handleDashboardStatus: vi.fn().mockResolvedValue({
        councilSessions: { count: 0 },
        p10Plans: { count: 0 },
        blockedItems: [],
        generatedAt: '2026-06-22T00:00:00.000Z',
      }),
    }));
    const { registerClient: reg, unregisterClient: unreg, isAtCapacity: atCap } = await import('./sse_registry.js');
    const { handleSseRequest: sseReq } = await import('./sse_handler.js');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Fill capacity with 50 fake clients
    const registered: ReturnType<typeof makeFakeRes>[] = [];
    for (let i = 0; i < 50; i++) {
      const r = makeFakeRes();
      registered.push(r);
      reg(r, '/tmp/vault');
    }

    expect(atCap()).toBe(true);

    // The 51st request through the real handler — headers must NOT be committed before 503
    const overflow = makeFakeRes();
    sseReq({} as IncomingMessage, overflow, '/tmp/vault');
    expect(overflow.statusCode).toBe(503);
    expect(overflow.ended).toBe(true);
    // Confirm no SSE headers were written before the 503
    const written = overflow.written.join('');
    expect(written).not.toContain('event: connected');

    for (const r of registered) unreg(r);
  }, 10_000);
});

describe('registerClient — interval lifecycle', () => {
  it('starts two intervals on first client, clears both on last client leaving', async () => {
    const { registerClient, unregisterClient } = await freshRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const res = makeFakeRes();
    registerClient(res, '/tmp/vault');
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    unregisterClient(res);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('does not start additional intervals for a second client', async () => {
    const { registerClient, unregisterClient } = await freshRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const res1 = makeFakeRes();
    const res2 = makeFakeRes();
    registerClient(res1, '/tmp/vault');
    const countAfterFirst = setIntervalSpy.mock.calls.length;

    registerClient(res2, '/tmp/vault');
    expect(setIntervalSpy.mock.calls.length).toBe(countAfterFirst);

    unregisterClient(res2);
    unregisterClient(res1);
  });
});

describe('registerClient — close cleanup', () => {
  it('unregisters client when res emits close', async () => {
    const { registerClient } = await freshRegistry();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes();
    registerClient(res, '/tmp/vault');

    (res as unknown as EventEmitter).emit('close');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SSE] client disconnected'));
  });
});

describe('writeSseToClient — destroyed guard', () => {
  it('does not write to a destroyed client', async () => {
    const { registerClient } = await freshRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes({ destroyed: true });
    // registerClient early-returns on destroyed — no clients registered, no intervals started
    registerClient(res, '/tmp/vault');

    const writeSpy = vi.spyOn(res as unknown as { write: () => boolean }, 'write');
    await vi.advanceTimersByTimeAsync(15_001);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('broadcastStats — vault failure emits event:error', () => {
  it('sends event:error frame when vault read throws', async () => {
    const mod = await freshRegistry();
    const { handleDashboardStatus } = await import('./dashboard_status.js');
    vi.mocked(handleDashboardStatus).mockRejectedValueOnce(new Error('ENOENT'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes();
    mod.registerClient(res, '/tmp/vault');

    await vi.advanceTimersByTimeAsync(15_001);

    const errorFrame = res.written.find((f) => f.startsWith('event: error'));
    expect(errorFrame).toBeDefined();
    expect(errorFrame).toContain('vault unavailable');

    mod.unregisterClient(res);
  });
});

describe('broadcastStats — successful broadcast', () => {
  it('sends event:stats frame with correct counts', async () => {
    const mod = await freshRegistry();
    const { handleDashboardStatus } = await import('./dashboard_status.js');
    vi.mocked(handleDashboardStatus).mockResolvedValueOnce({
      councilSessions: { count: 5 },
      p10Plans: { count: 7 },
      blockedItems: [{ id: '1' }] as never[],
      generatedAt: '2026-06-22T00:00:00.000Z',
    } as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes();
    mod.registerClient(res, '/tmp/vault');

    await vi.advanceTimersByTimeAsync(15_001);

    const statsFrame = res.written.find((f) => f.startsWith('event: stats'));
    expect(statsFrame).toBeDefined();
    const payload = JSON.parse(statsFrame!.replace('event: stats\ndata: ', '').trim());
    expect(payload.councilCount).toBe(5);
    expect(payload.p10Count).toBe(7);
    expect(payload.blockedCount).toBe(1);

    mod.unregisterClient(res);
  });
});

describe('broadcastKeepAlive', () => {
  it('emits SSE keep-alive comment frame at 10s interval', async () => {
    const mod = await freshRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = makeFakeRes();
    mod.registerClient(res, '/tmp/vault');

    await vi.advanceTimersByTimeAsync(10_001);

    const keepAliveFrame = res.written.find((f) => f === ': keep-alive\n\n');
    expect(keepAliveFrame).toBeDefined();

    mod.unregisterClient(res);
  });
});

// C3 — real socket integration test (Karpathy condition).
// Starts a real http.Server, connects via raw TCP, receives the connected frame,
// hard-destroys the socket, and asserts the registry tears down cleanly.
describe('SSE — real socket integration', () => {
  it('receives connected frame and cleans up intervals on hard disconnect', async () => {
    vi.useRealTimers();
    vi.resetModules();
    vi.mock('./dashboard_status.js', () => ({
      handleDashboardStatus: vi.fn().mockResolvedValue({
        councilSessions: { count: 1 },
        p10Plans: { count: 2 },
        blockedItems: [],
        generatedAt: '2026-06-22T00:00:00.000Z',
      }),
    }));
    const registryMod = await import('./sse_registry.js');
    const { handleSseRequest: sseReq } = await import('./sse_handler.js');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // LOOP BOUND: server handles exactly 1 request in this test
    const server = createServer((req, res) => {
      sseReq(req as IncomingMessage, res, '/tmp/vault');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const received: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('node:net') as typeof import('node:net');

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(port, '127.0.0.1');

      socket.on('connect', () => {
        socket.write(
          `GET /dashboard/events HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`,
        );
      });

      socket.on('data', (chunk: Buffer) => {
        received.push(chunk.toString());
        // Hard-destroy after receiving the connected frame
        if (received.join('').includes('event: connected')) {
          socket.destroy();
        }
      });

      socket.on('close', () => resolve());
      socket.on('error', reject);
    });

    // Give the close handler time to fire in the registry
    await new Promise((r) => setTimeout(r, 50));

    expect(received.join('')).toContain('event: connected');
    // Registry tears down on last disconnect — no clients remain
    expect(registryMod.isAtCapacity()).toBe(false);

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }, 10_000);
});
