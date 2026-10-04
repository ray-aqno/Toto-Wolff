// toto-wolff MCP server entry, started by Claude Code as
// `node ${CLAUDE_PLUGIN_ROOT}/server/index.mts`. Node runs it directly by
// stripping its types; the .mts extension makes every file an ES module
// whatever package.json sits above the install. Only erasable TypeScript,
// relative .mts imports and node: built-ins are allowed under plugin/server.
import process from 'node:process';
import { createServer } from './mcp/server.mts';
import { runStdio } from './mcp/stdio.mts';
import { TOOLS } from './tools/index.mts';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from './version.mts';

if (checkNodeVersion(process.versions.node)) {
  runStdio(createServer(TOOLS)).catch((err: unknown) => {
    process.stderr.write(`toto-wolff: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
} else {
  process.stderr.write(`${NODE_VERSION_MESSAGE}\n`);
  process.exitCode = 1;
}
