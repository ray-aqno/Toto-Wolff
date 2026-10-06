// Environment for tests that spawn the real server entry: HOME and the vault
// in a fresh temp directory, and no plugin settings or DRS config from the
// developer's shell, so nothing touches the real HOME and stderr stays empty.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created: string[] = [];

export const TOOL_NAMES = ['vault_write', 'vault_search', 'drs_check', 'subagent_list', 'dashboard_status', 'score_confidence', 'graph_list', 'graph_template', 'graph_start', 'graph_next', 'graph_report', 'graph_approve', 'graph_status', 'graph_resume'];

export function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'toto-plugin-spawn-'));
  created.push(dir);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, TOTO_VAULT_PATH: join(dir, 'vault'), ...extra };
  if (extra['TOTO_MCP_PORT'] === undefined) delete env['TOTO_MCP_PORT'];
  delete env['TOTO_DRS_CONFIG'];
  for (const name of ['TOTO_WOLFF_VAULT', 'TOTO_WOLFF_PROJECT']) if (extra[name] === undefined) delete env[name];
  return env;
}

// The server's settings, as plugin.json passes them in its env block: a fresh
// temp vault, plus either of vault and project in `extra`.
export function serverEnv(extra: Partial<Record<'vault' | 'project', string>> = {}): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'toto-plugin-settings-'));
  created.push(dir);
  const config = { vault: join(dir, 'vault'), ...extra };
  return Object.fromEntries(Object.entries(config).map(([name, value]) => [`TOTO_WOLFF_${name.toUpperCase()}`, value]));
}

export function removeIsolatedEnvs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
