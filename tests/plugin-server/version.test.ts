import { describe, expect, it } from 'vitest';
import { NODE_VERSION_MESSAGE, checkNodeVersion } from '../../plugin/server/version.mts';

describe('checkNodeVersion', () => {
  it.each(['24.0.0', '24.18.0', '25.1.0'])('accepts %s', (version) => {
    expect(checkNodeVersion(version)).toBe(true);
  });

  it.each(['22.18.0', '23.6.0', '20.19.0', 'abc', '', 'v24.0.0'])('refuses %s', (version) => {
    expect(checkNodeVersion(version)).toBe(false);
  });

  it('names the required major in its message', () => {
    expect(NODE_VERSION_MESSAGE).toBe('toto-wolff needs Node 24+');
  });
});
