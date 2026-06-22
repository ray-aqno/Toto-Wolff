import * as http from "node:http";
import { execFile } from "node:child_process";

/**
 * Resolves the dashboard URL from TOTO_MCP_PORT env (default 3099).
 * Always targets loopback — the MCP server rejects non-loopback connections.
 */
function dashboardUrl(): string {
  const port = process.env["TOTO_MCP_PORT"] ?? "3099";
  return `http://127.0.0.1:${port}/dashboard`;
}

/**
 * Issues a HEAD request to the given URL with a 2-second timeout.
 * Resolves true if the server responds with any HTTP status code.
 * Resolves false on connection error or timeout.
 */
function isServerReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        method: "HEAD",
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
      },
      () => {
        resolve(true);
      }
    );
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.end();
  });
}

/**
 * Opens the given URL in the default browser using the platform-appropriate
 * command: 'open' on macOS, 'xdg-open' on Linux. Exits 1 on failure.
 * Windows is out of scope — the MCP server is loopback-only and this path
 * is never reached on win32.
 */
function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [url], (err) => {
    if (err) {
      process.stderr.write(`toto dashboard: failed to open browser — ${err.message}\n`);
      process.exit(1);
    }
  });
}

/**
 * Command handler for `toto dashboard`.
 * Checks that the MCP server is reachable before opening the browser.
 * Exits 1 with a clear error message if the server is down.
 */
export async function runDashboard(): Promise<void> {
  const url = dashboardUrl();
  const reachable = await isServerReachable(url);

  if (!reachable) {
    process.stderr.write(
      `toto dashboard: MCP server not reachable at ${url}\n` +
        `Start the MCP server first, then run 'toto dashboard' again.\n` +
        `If the server crashes on startup, check that ANTHROPIC_AUTH_TOKEN is set in ~/.claude.json.\n`
    );
    process.exit(1);
  }

  openBrowser(url);
}
