import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import { createAnthropicClient } from './anthropic.js';

const originalEnv = { ...process.env };

/** Simulates no ~/.claude.json (or no readable one) on disk. */
function mockClaudeJsonMissing(): void {
  vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  });
}

function resetEnvAndMocks(): void {
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_AUTH_TOKEN'];
}

function restoreEnvAndMocks(): void {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
}

describe('createAnthropicClient — shell environment', () => {
  beforeEach(resetEnvAndMocks);
  afterEach(restoreEnvAndMocks);

  it('constructs with ANTHROPIC_API_KEY set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('constructs with ANTHROPIC_AUTH_TOKEN set', () => {
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('constructs with both set (no error)', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('throws when neither credential is set anywhere (env or ~/.claude.json)', () => {
    mockClaudeJsonMissing();
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('treats empty strings as not set and throws when the file fallback is also absent', () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    process.env['ANTHROPIC_AUTH_TOKEN'] = '';
    mockClaudeJsonMissing();
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });
});

describe('createAnthropicClient — ~/.claude.json fallback', () => {
  beforeEach(resetEnvAndMocks);
  afterEach(restoreEnvAndMocks);

  it('falls back to ANTHROPIC_API_KEY when no env vars are set', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
      }),
    );
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('falls back to ANTHROPIC_AUTH_TOKEN when no env vars are set', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        mcpServers: { 'toto-wolff': { env: { ANTHROPIC_AUTH_TOKEN: 'bearer-from-file' } } },
      }),
    );
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });
});

describe('createAnthropicClient — ~/.claude.json fallback failure modes', () => {
  beforeEach(resetEnvAndMocks);
  afterEach(restoreEnvAndMocks);

  it('throws (does not crash) when the file exists but is malformed JSON', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{ not valid json');
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('throws when the file exists but has no mcpServers key at all', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ someOtherKey: true }));
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('throws when the mcpServers.toto-wolff entry exists but has no env field', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ mcpServers: { 'toto-wolff': { command: 'node' } } }),
    );
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('throws when the file exists but has no mcpServers.toto-wolff entry', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ mcpServers: { 'some-other-server': { env: { ANTHROPIC_API_KEY: 'x' } } } }),
    );
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('treats a permission-denied ~/.claude.json read as not-found, not a crash', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });
});

describe('createAnthropicClient — precedence', () => {
  beforeEach(resetEnvAndMocks);
  afterEach(restoreEnvAndMocks);

  it('prefers shell env over the file when both are present (file never consulted)', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-from-env';
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
      }),
    );
    const client = createAnthropicClient();
    expect(client).toBeDefined();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it('falls through to the file when the env var is an empty string, not a short-circuit', () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
      }),
    );
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('prefers env ANTHROPIC_AUTH_TOKEN over file even when API_KEY is unset', () => {
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'token-from-env';
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
      }),
    );
    const client = createAnthropicClient();
    expect(client).toBeDefined();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });
});
