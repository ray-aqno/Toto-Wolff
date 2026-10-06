// toto-wolff MCP server entry, started by Claude Code as
// `node ${CLAUDE_PLUGIN_ROOT}/server/index.mts`. Node runs it directly by
// stripping its types; the .mts extension makes every file an ES module
// whatever package.json sits above the install. Only erasable TypeScript,
// relative .mts imports and node: built-ins are allowed under plugin/server.
import process from 'node:process';
import { dashboardPort, startDashboard } from './dashboard/http.mts';
import { createServer } from './mcp/server.mts';
import { runStdio } from './mcp/stdio.mts';
import { createRuntime } from './runtime.mts';
import { createTools } from './tools/index.mts';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from './version.mts';

// Builds the tools inside the promise, so a bad TOTO_VAULT_PATH is one stderr
// line. The dashboard runs only when TOTO_MCP_PORT is set, and closes when
// stdin ends, so the process exits with its client.
// The server sees only the variables it uses, never the user's whole
// environment.
const USED_ENV = ['TOTO_VAULT_PATH', 'HOME', 'CLAUDE_PROJECT_DIR', 'TOTO_MCP_PORT'] as const;

function usedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // LOOP BOUND: USED_ENV's 4 names.
  for (const name of USED_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

async function start(): Promise<void> {
  const env = usedEnv();
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
