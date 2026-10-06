// toto-wolff MCP server entry, which Claude Code starts over stdio as the
// plugin's MCP server. Node runs it directly by stripping its types; the
// .mts extension makes every file an ES module
// whatever package.json sits above the install. Only erasable TypeScript,
// relative .mts imports and node: built-ins are allowed under plugin/server.
import process from 'node:process';
import { createLineHandler } from './mcp/server.mts';
import { runStdio } from './mcp/stdio.mts';
import { configFromEnv, createRuntime } from './runtime.mts';
import { createTools } from './tools/index.mts';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from './version.mts';

// Builds the tools inside the promise, so a missing or bad vault folder is one
// stderr line. The process exits when stdin ends, with its client.
async function start(): Promise<void> {
  // Only the plugin's two settings (plugin.json's env block), by name.
  const env = configFromEnv({
    TOTO_WOLFF_VAULT: process.env['TOTO_WOLFF_VAULT'],
    TOTO_WOLFF_PROJECT: process.env['TOTO_WOLFF_PROJECT'],
  });
  await runStdio(createLineHandler(createTools(createRuntime(env))));
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
