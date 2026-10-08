// A static guard over the shipped plugin tree: nothing under plugin/ may open
// a socket, serve HTTP or make a request. The plugin has no dashboard page or
// server (dashboard_status returns the stats only), so none of these patterns
// has a reason to come back.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin');
const PATTERNS = ["from 'node:http", 'node:https', 'node:net', 'node:tls', 'node:dgram', 'fetch(', 'EventSource', '.listen('];
const MAX_FILES = 2000;

// Every file under dir, depth first; symbolic links are not followed.
function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
    if (out.length > MAX_FILES) throw new Error('plugin/ has more files than this guard expects');
  }
  return out;
}

describe('the plugin has no network surface', () => {
  const files = walk(PLUGIN, []);

  it('walks the server and the skills', () => {
    expect(files.some((f) => f.endsWith(join('server', 'index.mts')))).toBe(true);
    expect(files.some((f) => f.endsWith('SKILL.md'))).toBe(true);
  });

  it('contains none of the network patterns', () => {
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return PATTERNS.filter((p) => text.includes(p)).map((p) => `${relative(PLUGIN, file)}: ${p}`);
    });
    expect(hits).toEqual([]);
  });
});
