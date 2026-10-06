// The server's settings come from its env block, which plugin.json fills from
// userConfig and ${CLAUDE_PROJECT_DIR}; no other variable is read.
import { describe, expect, it } from 'vitest';
import { configFromEnv, resolveVaultPath } from '../../plugin/server/runtime.mts';

describe('configFromEnv', () => {
  it('reads the three plugin settings and nothing else', () => {
    expect(configFromEnv({ TOTO_WOLFF_VAULT: '/v', TOTO_WOLFF_PROJECT: '/p', TOTO_WOLFF_PORT: '3099', TOTO_VAULT_PATH: '/old', HOME: '/h' })).toEqual({ vault: '/v', project: '/p', port: '3099' });
  });

  it('leaves out empty values, unsubstituted references and port 0', () => {
    expect(configFromEnv({ TOTO_WOLFF_VAULT: '', TOTO_WOLFF_PROJECT: '${CLAUDE_PROJECT_DIR}', TOTO_WOLFF_PORT: '0' })).toEqual({});
  });
});

describe('resolveVaultPath', () => {
  it('needs a configured vault folder: no home-folder default', () => {
    expect(() => resolveVaultPath({})).toThrow('set it in /plugin > toto-wolff > Configure');
    expect(resolveVaultPath({ vault: '/v/vault' })).toBe('/v/vault');
  });
});
