// toto-wolff MCP server entry, started by Claude Code as
// `node ${CLAUDE_PLUGIN_ROOT}/server/index.mts`. Node runs it directly by
// stripping its types; the .mts extension makes every file an ES module
// whatever package.json sits above the install. Only erasable TypeScript,
// relative .mts imports and node: built-ins are allowed under plugin/server.
import process from 'node:process';
import { dashboardPort, startDashboard } from './dashboard/http.mts';
import { createServer } from './mcp/server.mts';
import { runStdio } from './mcp/stdio.mts';
import { configFromEnv, createRuntime } from './runtime.mts';
import { createTools } from './tools/index.mts';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from './version.mts';

// Builds the tools inside the promise, so a missing or bad vault folder is one
// stderr line. The dashboard runs only when a port is configured, and closes when
// stdin ends, so the process exits with its client.
async function start(): Promise<void> {
  // Only the plugin's three settings (plugin.json's env block), by name.
  const env = configFromEnv({
    TOTO_WOLFF_VAULT: process.env['TOTO_WOLFF_VAULT'],
    TOTO_WOLFF_PROJECT: process.env['TOTO_WOLFF_PROJECT'],
    TOTO_WOLFF_PORT: process.env['TOTO_WOLFF_PORT'],
  });
  const runtime = createRuntime(env);
  const port = dashboardPort(env);
  const dashboard = port === null ? null : await startDashboard({ port, vaultPath: runtime.vaultPath });
  try {
    await runStdio(createServer(createTools(runtime)));
  } finally {
    await dashboard?.close();
  }
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
