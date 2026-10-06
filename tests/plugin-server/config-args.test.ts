// The server's settings come from its arguments (plugin.json fills them from
// userConfig and ${CLAUDE_PROJECT_DIR}), never from the user's environment.
import { describe, expect, it } from 'vitest';
import { configFromArgs, resolveVaultPath } from '../../plugin/server/runtime.mts';

describe('configFromArgs', () => {
  it('maps the three flags to their settings', () => {
    expect(configFromArgs(['--vault', '/v', '--project', '/p', '--port', '3099'])).toEqual({ vault: '/v', project: '/p', port: '3099' });
  });

  it('leaves out empty values, unsubstituted references and port 0', () => {
    expect(configFromArgs(['--vault', '', '--project', '${CLAUDE_PROJECT_DIR}', '--port', '0'])).toEqual({});
  });

  it('refuses an unknown flag or a flag without a value', () => {
    expect(() => configFromArgs(['--home', '/h'])).toThrow('unknown argument: --home');
    expect(() => configFromArgs(['--vault'])).toThrow('unknown argument: --vault');
  });
});

describe('resolveVaultPath', () => {
  it('needs a configured vault folder: no home-folder default', () => {
    expect(() => resolveVaultPath({})).toThrow('set it in /plugin > toto-wolff > Configure');
    expect(resolveVaultPath({ vault: '/v/vault' })).toBe('/v/vault');
  });
});
