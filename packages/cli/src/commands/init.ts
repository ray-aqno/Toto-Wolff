import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MCP_KEY = "toto-wolff";

/**
 * Build the default MCP entry for toto-wolff. Resolves the dist path from
 * this file's location so the entry is correct regardless of install location.
 */
function buildMcpEntry(): Record<string, unknown> {
  // __filename is not available in ESM — use import.meta.url
  const distDir = path.dirname(new URL(import.meta.url).pathname);
  const serverPath = path.resolve(
    distDir,
    "..",
    "..",
    "..",
    "mcp-server",
    "dist",
    "index.js"
  );
  return {
    type: "stdio",
    command: "node",
    args: [serverPath],
    env: {},
  };
}

/**
 * Read ~/.claude/settings.json and return its parsed contents. Returns an
 * empty object when the file does not exist (ENOENT). Re-throws all other
 * errors.
 */
async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

/**
 * Insert or update the toto-wolff MCP server entry in the settings object.
 * Returns a new object — does not mutate the input.
 */
export function mergeSettings(
  existing: Record<string, unknown>
): Record<string, unknown> {
  const mcpServers =
    (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (MCP_KEY in mcpServers) {
    return existing;
  }
  return {
    ...existing,
    mcpServers: {
      ...mcpServers,
      [MCP_KEY]: buildMcpEntry(),
    },
  };
}

/**
 * Run the init command: read ~/.claude/settings.json, insert the toto-wolff
 * MCP entry if absent, write back, and print confirmation.
 */
export async function runInit(): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    settings = await readSettings();
  } catch (err) {
    process.stderr.write(`toto init: failed to read settings — ${String(err)}\n`);
    process.exit(1);
  }

  const mcpServers = (settings.mcpServers as Record<string, unknown>) ?? {};
  const alreadyPresent = MCP_KEY in mcpServers;
  const updated = mergeSettings(settings);

  try {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(`toto init: failed to write settings — ${String(err)}\n`);
    process.exit(1);
  }

  if (alreadyPresent) {
    process.stdout.write(`toto-wolff MCP entry already present in ${SETTINGS_PATH}\n`);
  } else {
    process.stdout.write(`toto-wolff MCP entry added to ${SETTINGS_PATH}\n`);
  }
}
