import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import assert from 'node:assert';
import { VaultService, CouncilService, P10Service } from '@toto-wolff/core';
import { MCPValidationError, handleVaultWrite } from './handlers/vault_write.js';
import { handleVaultSearch } from './handlers/vault_search.js';
import { handleCouncilRun } from './handlers/council_run.js';
import { handleP10Plan } from './handlers/p10_plan.js';

const PORT = parseInt(process.env['TOTO_MCP_PORT'] ?? '3099', 10);
const VAULT_PATH = process.env['TOTO_VAULT_PATH'] ?? `${process.env['HOME'] ?? ''}/Documents/Obsidian Vault`;

assert(isAbsolute(VAULT_PATH), 'VAULT_PATH must be absolute');
// CSO: API key presence checked at service construction, not here — avoids logging it

const vault = new VaultService(VAULT_PATH);
const council = new CouncilService(vault);
const p10 = new P10Service(vault);

const TOOLS: Record<string, (body: unknown) => Promise<unknown>> = {
  vault_write:  (body) => handleVaultWrite(body, vault),
  vault_search: (body) => handleVaultSearch(body, vault),
  council_run:  (body) => handleCouncilRun(body, council),
  p10_plan:     (body) => handleP10Plan(body, p10),
};

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
  req.on('end', () => {
    void handleRequest(req.url ?? '', raw, res);
  });
});

async function handleRequest(url: string, raw: string, res: import('node:http').ServerResponse): Promise<void> {
  const tool = url.replace(/^\//, '');
  const handler = TOOLS[tool];
  if (handler === undefined) {
    res.writeHead(404).end(JSON.stringify({ error: 'unknown tool' }));
    return;
  }
  try {
    const body: unknown = JSON.parse(raw);
    const result = await handler(body);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    const isBadInput = err instanceof MCPValidationError || err instanceof SyntaxError;
    const status = isBadInput ? 400 : 500;
    // CSO: never reflect raw error internals — only message, no stack
    res.writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: (err as Error).message }));
  }
}

// LOOP BOUND: 1 attempt — fail loud on EADDRINUSE, no retry (Condition 3)
server.listen(PORT, () => {
  process.stdout.write(`toto-mcp listening on port ${PORT}\n`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`ERROR: Port ${PORT} in use. Set TOTO_MCP_PORT to a free port.\n`);
    process.exit(1);
  }
  process.stderr.write(`ERROR: server error: ${err.message}\n`);
  process.exit(1);
});
