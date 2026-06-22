import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import path from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { handleRecordRequest } from './record_handler.js';

const VAULT = '/tmp/test-vault';

function makeReq(url: string): IncomingMessage {
  return { url } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { statusCode: number; written: string[]; ended: boolean } {
  const ee = new EventEmitter();
  return Object.assign(ee, {
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    written: [] as string[],
    ended: false,
    write(chunk: string) {
      this.written.push(chunk);
      return true;
    },
    writeHead(code: number, _headers?: Record<string, string>) {
      this.statusCode = code;
      return this;
    },
    end(body?: string) {
      this.ended = true;
      if (body) this.written.push(body);
      return this;
    },
  }) as unknown as ServerResponse & { statusCode: number; written: string[]; ended: boolean };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleRecordRequest — missing params', () => {
  it('returns 400 when type is missing', async () => {
    const res = makeRes();
    await handleRecordRequest(makeReq('/dashboard/record?file=2026-06-22-foo.md'), res, VAULT);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when file is missing', async () => {
    const res = makeRes();
    await handleRecordRequest(makeReq('/dashboard/record?type=council'), res, VAULT);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when both params are missing', async () => {
    const res = makeRes();
    await handleRecordRequest(makeReq('/dashboard/record'), res, VAULT);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleRecordRequest — invalid type', () => {
  it('returns 404 for unknown type', async () => {
    const res = makeRes();
    await handleRecordRequest(makeReq('/dashboard/record?type=unknown&file=foo.md'), res, VAULT);
    expect(res.statusCode).toBe(404);
  });
});

describe('handleRecordRequest — path traversal', () => {
  it('returns 404 for filename with ..',  async () => {
    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=..%2F..%2Fetc%2Fpasswd'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for filename with embedded slash', async () => {
    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=p10&file=subdir%2Ffoo.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for sibling-prefix traversal (vault-evil attack)', async () => {
    // /tmp/test-vault-evil should not be accessible even though startsWith('/tmp/test-vault') is true
    const res = makeRes();
    // This would only be possible if resolved path escapes vault — filename normalization catches it first
    // but we also test that the isInsideVault check uses path.sep suffix
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=' + encodeURIComponent('../test-vault-evil/secret.md')),
      res, VAULT,
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('handleRecordRequest — ENOENT → 404', () => {
  it('returns 404 when file does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValueOnce(enoent);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=2026-06-22-session.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(404);
    expect(res.written.join('')).toContain('Record not found.');
  });
});

describe('handleRecordRequest — non-ENOENT error → 500', () => {
  it('returns 500 for EACCES', async () => {
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValueOnce(eacces);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=2026-06-22-session.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(500);
    expect(res.written.join('')).toContain('Internal error.');
  });
});

describe('handleRecordRequest — 100KB cap → 413', () => {
  it('returns 413 when file exceeds 100_000 bytes', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('x'.repeat(100_001) as never);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=p10&file=2026-06-22-plan.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(413);
  });

  it('serves a file at exactly 100_000 bytes (boundary)', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('x'.repeat(100_000) as never);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=p10&file=2026-06-22-plan.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('handleRecordRequest — valid requests', () => {
  it('serves a council record with 200 and text/plain content-type', async () => {
    const content = '# Council Record\n\nSome content here.';
    vi.mocked(readFile).mockResolvedValueOnce(content as never);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=2026-06-22-session.md'),
      res, VAULT,
    );
    expect(res.statusCode).toBe(200);
    expect(res.written.join('')).toBe(content);
  });

  it('resolves council file inside Council/Congressional-Records subdir', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('ok' as never);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=council&file=2026-06-22-session.md'),
      res, VAULT,
    );

    const calledPath = vi.mocked(readFile).mock.calls[0]?.[0] as string;
    expect(calledPath).toBe(
      path.join(VAULT, 'Council', 'Congressional-Records', '2026-06-22-session.md'),
    );
  });

  it('resolves p10 file inside P10-Plans subdir', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('ok' as never);

    const res = makeRes();
    await handleRecordRequest(
      makeReq('/dashboard/record?type=p10&file=2026-06-22-plan.md'),
      res, VAULT,
    );

    const calledPath = vi.mocked(readFile).mock.calls[0]?.[0] as string;
    expect(calledPath).toBe(path.join(VAULT, 'P10-Plans', '2026-06-22-plan.md'));
  });
});
