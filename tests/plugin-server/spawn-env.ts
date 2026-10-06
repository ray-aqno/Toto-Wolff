// Environment for tests that spawn the real server entry: HOME and the vault
// in a fresh temp directory, and no dashboard port or DRS config from the
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
  return env;
}

// The server's arguments, as plugin.json passes them: a fresh temp vault, plus
// any of vault, project and port in `extra`.
export function serverArgs(extra: Partial<Record<'vault' | 'project' | 'port', string>> = {}): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'toto-plugin-args-'));
  created.push(dir);
  const config = { vault: join(dir, 'vault'), ...extra };
  return Object.entries(config).flatMap(([name, value]) => [`--${name}`, value]);
}

export function removeIsolatedEnvs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
