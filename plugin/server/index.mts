// toto-wolff MCP server entry, started by Claude Code as
// `node ${CLAUDE_PLUGIN_ROOT}/server/index.mts`. Node runs it directly by
// stripping its types; the .mts extension makes every file an ES module
// whatever package.json sits above the install. Only erasable TypeScript,
// relative .mts imports and node: built-ins are allowed under plugin/server.
import process from 'node:process';
import { createServer } from './mcp/server.mts';
import { runStdio } from './mcp/stdio.mts';
import { createRuntime } from './runtime.mts';
import { createTools } from './tools/index.mts';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from './version.mts';

// Builds the tools inside the promise, so a bad TOTO_VAULT_PATH is one stderr line.
async function start(): Promise<void> {
  await runStdio(createServer(createTools(createRuntime(process.env))));
}

if (checkNodeVersion(process.versions.node)) {
  start().catch((err: unknown) => {
    process.stderr.write(`toto-wolff: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
} else {
  process.stderr.write(`${NODE_VERSION_MESSAGE}\n`);
  process.exitCode = 1;
}
