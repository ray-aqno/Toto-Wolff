import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import os from "node:os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MCP_KEY = "toto-wolff";
const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Pure function: return true if the given env map contains a non-empty
 * ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY. Accepts an env argument so
 * callers can inject test values without mutating process.env.
 */
export function checkEnv(env: Record<string, string | undefined> = process.env): boolean {
  const token = env["ANTHROPIC_AUTH_TOKEN"] ?? env["ANTHROPIC_API_KEY"];
  return typeof token === "string" && token.length > 0;
}

/** Check that at least one Anthropic auth env var is set and non-empty. */
function checkAuthToken(): CheckResult {
  const passed = checkEnv(process.env as Record<string, string | undefined>);
  return {
    label: "ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY",
    passed,
    detail: passed ? "set" : "not set — export ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY",
  };
}

/**
 * Check that ~/.claude/settings.json contains the toto-wolff MCP entry.
 * Handles ENOENT and JSON parse errors as failures (not crashes).
 */
async function checkMcpEntry(): Promise<CheckResult> {
  const label = `toto-wolff MCP entry in ${SETTINGS_PATH}`;
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers =
      (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
    const passed = MCP_KEY in mcpServers;
    return {
      label,
      passed,
      detail: passed ? "present" : "missing — run `toto init`",
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail =
      code === "ENOENT"
        ? `${SETTINGS_PATH} not found — run \`toto init\``
        : `could not read settings — ${String(err)}`;
    return { label, passed: false, detail };
  }
}

/**
 * Check that the vault directory exists. Reads VAULT_PATH env var
 * first; falls back to ~/.toto/vault.
 */
async function checkVaultPath(): Promise<CheckResult> {
  const vaultPath = process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const label = `Vault path (${vaultPath})`;
  try {
    const stat = await fs.stat(vaultPath);
    const passed = stat.isDirectory();
    return {
      label,
      passed,
      detail: passed ? "exists" : `${vaultPath} is not a directory`,
    };
  } catch {
    return {
      label,
      passed: false,
      detail: `${vaultPath} does not exist — set VAULT_PATH or create the directory`,
    };
  }
}

/**
 * INFO-level check: probe Ollama's /api/tags endpoint.
 * Never exits 1 — Ollama is optional. Shows available models when reachable.
 */
async function checkOllama(): Promise<CheckResult> {
  const host = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  const label = `Ollama (${host})`;

  return new Promise((resolve) => {
    const url = new URL("/api/tags", host);
    const lib = url.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve({ label, passed: false, detail: `HTTP ${res.statusCode ?? "unknown"}` });
            return;
          }
          try {
            const body = JSON.parse(raw) as { models?: Array<{ name: string }> };
            const names = (body.models ?? []).map((m) => m.name);
            const detail = names.length > 0
              ? `running · ${names.length} model${names.length > 1 ? "s" : ""}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`
              : "running · no models pulled yet";
            resolve({ label, passed: true, detail });
          } catch {
            resolve({ label, passed: true, detail: "running" });
          }
        });
      },
    );

    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ label, passed: false, detail: "not running (timeout) — set TOTO_RADIO_PROVIDER=ollama to use as radio backend" });
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      const detail = err.code === "ECONNREFUSED"
        ? "not running — start with: ollama serve"
        : `unreachable — ${err.message}`;
      resolve({ label, passed: false, detail });
    });

    req.end();
  });
}

/** Format and print a check result line. */
function printCheck(result: CheckResult, info = false): void {
  const icon = info ? "INFO" : result.passed ? "PASS" : "FAIL";
  process.stdout.write(`  [${icon}] ${result.label}: ${result.detail}\n`);
}

/**
 * Run the doctor command: check auth token, MCP entry, vault path, and Ollama (INFO).
 * Exits 1 if any required check fails. Ollama failure is informational only.
 */
export async function runDoctor(): Promise<void> {
  process.stdout.write("toto doctor\n\n");

  const authResult = checkAuthToken();
  const [mcpResult, vaultResult, ollamaResult] = await Promise.all([
    checkMcpEntry(),
    checkVaultPath(),
    checkOllama(),
  ]);

  const required: CheckResult[] = [authResult, mcpResult, vaultResult];
  for (const r of required) {
    printCheck(r);
  }
  printCheck(ollamaResult, true);

  process.stdout.write("\n");
  const anyFailed = required.some((r) => !r.passed);
  if (anyFailed) {
    process.stdout.write("doctor: one or more checks failed\n");
    process.exit(1);
  } else {
    process.stdout.write("doctor: all checks passed\n");
  }
}
