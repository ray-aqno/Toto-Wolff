// dashboard_status when the page file cannot be written (2.0.0): the stats
// still come back, with page null and one stderr line. Its own file, because
// one server process (and so one test file) serves one vault.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLineHandler } from '../../plugin/server/mcp/server.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';

describe('dashboard_status when the page cannot be written', () => {
  it('still returns the stats, with page null and one stderr line', async () => {
    const other = mkdtempSync(join(tmpdir(), 'toto-page-fail-'));
    try {
      writeFileSync(join(other, '.toto-wolff'), 'a file where the page folder should be');
      const handle = createLineHandler(createTools(createRuntime({ vault: other, project: join(other, 'project') })));
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const reply = (await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dashboard_status', arguments: {} } }))) as {
          result?: { content: { text: string }[] };
        };
        expect(reply.result, JSON.stringify(reply)).toBeDefined();
        const status = JSON.parse(reply.result?.content[0]?.text ?? 'null') as Record<string, unknown>;
        expect(status['page']).toBeNull();
        expect(status).toHaveProperty('blockedItems');
        expect(stderr.mock.calls.filter(([text]) => String(text).includes('dashboard page not written'))).toHaveLength(1);
      } finally {
        stderr.mockRestore();
      }
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
