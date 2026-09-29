import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import { createAnthropicClient } from './anthropic.js';
const originalEnv = { ...process.env };
/** Simulates no ~/.claude.json (or no readable one) on disk. */
function mockClaudeJsonMissing() {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });
}
function resetEnvAndMocks() {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['TOTO_ANTHROPIC_API_KEY'];
    delete process.env['TOTO_ANTHROPIC_AUTH_TOKEN'];
    delete process.env['TOTO_ANTHROPIC_BASE_URL'];
}
function restoreEnvAndMocks() {
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
    it('constructs with ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL set', () => {
        process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        const client = createAnthropicClient();
        expect(client.authToken).toBe('bearer-test-456');
        expect(client.baseURL).toBe('https://gateway.shell.example');
    });
    it('rejects a shell token without a shell base URL instead of sending it to the public endpoint', () => {
        process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
        assert.throws(() => createAnthropicClient(), /without a base URL from the same source/);
    });
    it('rejects a shell key and token set together, even with a gateway URL', () => {
        process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
        process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        assert.throws(() => createAnthropicClient(), /both set in the same source/);
    });
    it('rejects a plugin key and token set together', () => {
        process.env['TOTO_ANTHROPIC_API_KEY'] = 'sk-from-plugin';
        process.env['TOTO_ANTHROPIC_AUTH_TOKEN'] = 'token-from-plugin';
        process.env['TOTO_ANTHROPIC_BASE_URL'] = 'https://gateway.plugin.example';
        assert.throws(() => createAnthropicClient(), /both set in the same source/);
    });
    it('rejects a ~/.claude.json key and token set together', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: {
                'toto-wolff': {
                    env: {
                        ANTHROPIC_API_KEY: 'sk-from-file',
                        ANTHROPIC_AUTH_TOKEN: 'token-from-file',
                        ANTHROPIC_BASE_URL: 'https://gateway.file.example',
                    },
                },
            },
        }));
        assert.throws(() => createAnthropicClient(), /both set in the same source/);
    });
    it('throws when neither credential is set anywhere (env or ~/.claude.json)', () => {
        mockClaudeJsonMissing();
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
    it('treats empty strings as not set and throws when the file fallback is also absent', () => {
        process.env['ANTHROPIC_API_KEY'] = '';
        process.env['ANTHROPIC_AUTH_TOKEN'] = '';
        mockClaudeJsonMissing();
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
});
describe('createAnthropicClient — ~/.claude.json fallback', () => {
    beforeEach(resetEnvAndMocks);
    afterEach(restoreEnvAndMocks);
    it('falls back to ANTHROPIC_API_KEY when no env vars are set', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client).toBeDefined();
    });
    it('falls back to ANTHROPIC_AUTH_TOKEN with its file base URL when no env vars are set', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: {
                'toto-wolff': {
                    env: {
                        ANTHROPIC_AUTH_TOKEN: 'bearer-from-file',
                        ANTHROPIC_BASE_URL: 'https://gateway.file.example',
                    },
                },
            },
        }));
        const client = createAnthropicClient();
        expect(client.authToken).toBe('bearer-from-file');
        expect(client.baseURL).toBe('https://gateway.file.example');
    });
});
describe('createAnthropicClient — ~/.claude.json fallback failure modes', () => {
    beforeEach(resetEnvAndMocks);
    afterEach(restoreEnvAndMocks);
    it('throws (does not crash) when the file exists but is malformed JSON', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('{ not valid json');
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
    it('throws when the file exists but has no mcpServers key at all', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ someOtherKey: true }));
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
    it('throws when the mcpServers.toto-wolff entry exists but has no env field', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ mcpServers: { 'toto-wolff': { command: 'node' } } }));
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
    it('throws when the file exists but has no mcpServers.toto-wolff entry', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ mcpServers: { 'some-other-server': { env: { ANTHROPIC_API_KEY: 'x' } } } }));
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
    it('treats a permission-denied ~/.claude.json read as not-found, not a crash', () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        });
        assert.throws(() => createAnthropicClient(), /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/);
    });
});
describe('createAnthropicClient — precedence', () => {
    beforeEach(resetEnvAndMocks);
    afterEach(restoreEnvAndMocks);
    it('prefers shell env over the file when both are present (file never consulted)', () => {
        process.env['ANTHROPIC_API_KEY'] = 'sk-from-env';
        const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client).toBeDefined();
        expect(readFileSyncSpy).not.toHaveBeenCalled();
    });
    it('falls through to the file when the env var is an empty string, not a short-circuit', () => {
        process.env['ANTHROPIC_API_KEY'] = '';
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client).toBeDefined();
    });
    it('prefers env ANTHROPIC_AUTH_TOKEN over file even when API_KEY is unset', () => {
        process.env['ANTHROPIC_AUTH_TOKEN'] = 'token-from-env';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client).toBeDefined();
        expect(readFileSyncSpy).not.toHaveBeenCalled();
    });
});
// Claude Code passes an unset optional userConfig value to the plugin's MCP
// server as an empty string (observed on 2.1.283), so these cases model what a
// plugin install actually receives, not just what a user might type.
describe('createAnthropicClient: plugin userConfig (TOTO_ANTHROPIC_*)', () => {
    beforeEach(resetEnvAndMocks);
    afterEach(restoreEnvAndMocks);
    it('uses the plugin key over a shell key and never reads the file', () => {
        process.env['TOTO_ANTHROPIC_API_KEY'] = 'sk-from-plugin';
        process.env['ANTHROPIC_API_KEY'] = 'sk-from-shell';
        const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-plugin');
        expect(readFileSyncSpy).not.toHaveBeenCalled();
    });
    it('keeps a shell-exported key when every userConfig value arrives empty', () => {
        process.env['TOTO_ANTHROPIC_API_KEY'] = '';
        process.env['TOTO_ANTHROPIC_AUTH_TOKEN'] = '';
        process.env['TOTO_ANTHROPIC_BASE_URL'] = '';
        process.env['ANTHROPIC_API_KEY'] = 'sk-from-shell';
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-shell');
    });
    it('falls through to ~/.claude.json when userConfig and shell are both empty', () => {
        process.env['TOTO_ANTHROPIC_API_KEY'] = '';
        process.env['TOTO_ANTHROPIC_AUTH_TOKEN'] = '';
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-file');
    });
    it('pairs a plugin auth token with the plugin base URL, not a shell one', () => {
        process.env['TOTO_ANTHROPIC_AUTH_TOKEN'] = 'token-from-plugin';
        process.env['TOTO_ANTHROPIC_BASE_URL'] = 'https://gateway.plugin.example';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        const client = createAnthropicClient();
        expect(client.authToken).toBe('token-from-plugin');
        expect(client.apiKey).toBeNull();
        expect(client.baseURL).toBe('https://gateway.plugin.example');
    });
    it('never sends a plugin credential to a shell base URL when the plugin URL is empty', () => {
        process.env['TOTO_ANTHROPIC_API_KEY'] = 'sk-from-plugin';
        process.env['TOTO_ANTHROPIC_BASE_URL'] = '';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-plugin');
        expect(client.baseURL).toBe('https://api.anthropic.com');
    });
    it('never sends a ~/.claude.json key to a shell base URL', () => {
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_API_KEY: 'sk-from-file' } } },
        }));
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-file');
        expect(client.baseURL).toBe('https://api.anthropic.com');
    });
    it('rejects a ~/.claude.json token without a file base URL, even when the shell has one', () => {
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
            mcpServers: { 'toto-wolff': { env: { ANTHROPIC_AUTH_TOKEN: 'token-from-file' } } },
        }));
        assert.throws(() => createAnthropicClient(), /without a base URL from the same source/);
    });
    it('rejects a plugin token without a plugin base URL, even when the shell has one', () => {
        process.env['TOTO_ANTHROPIC_AUTH_TOKEN'] = 'token-from-plugin';
        process.env['TOTO_ANTHROPIC_BASE_URL'] = '';
        process.env['ANTHROPIC_BASE_URL'] = 'https://gateway.shell.example';
        assert.throws(() => createAnthropicClient(), /without a base URL from the same source/);
    });
    it('ignores a plugin base URL when the credential comes from the shell', () => {
        process.env['TOTO_ANTHROPIC_BASE_URL'] = 'https://gateway.plugin.example';
        process.env['ANTHROPIC_API_KEY'] = 'sk-from-shell';
        const client = createAnthropicClient();
        expect(client.apiKey).toBe('sk-from-shell');
        expect(client.baseURL).toBe('https://api.anthropic.com');
    });
});
//# sourceMappingURL=anthropic.test.js.map