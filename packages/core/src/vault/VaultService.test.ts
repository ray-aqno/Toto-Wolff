import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VaultService } from './VaultService.js';

const execFileAsync = promisify(execFile);

describe('VaultService.search() searchCommand override (regression)', () => {
  let tmpDir: string;
  let fakeCommandPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-test-'));
    // A fake "rg" that ignores its arguments and always reports one fixed
    // match. Real ripgrep would never produce this output, so seeing it in
    // the result proves searchCommand's configured executable actually ran
    // — not that the code silently fell back to real rg or in-memory search.
    fakeCommandPath = join(tmpDir, 'fake-search-command.js');
    writeFileSync(
      fakeCommandPath,
      [
        '#!/usr/bin/env node',
        "console.log(JSON.stringify({ type: 'match', data: { path: { text: 'SENTINEL_FILE' }, line_number: 42, lines: { text: 'sentinel content' } } }));",
      ].join('\n'),
    );
    chmodSync(fakeCommandPath, 0o755);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes the configured searchCommand instead of real rg or the in-memory fallback', async () => {
    const vault = await VaultService.create({
      backend: 'file',
      options: { rootPath: tmpDir },
      searchCommand: fakeCommandPath,
    });

    const results = await vault.search('anything');

    expect(results).toEqual([{ file: 'SENTINEL_FILE', line: 42, text: 'sentinel content' }]);
  });
});

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: dir });
}

describe('VaultService shared-backend queue survival (regression)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-shared-test-'));
    await initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a shared backend queue survives one owning service closing, so another can still drain it', async () => {
    // Same backend id + options -> VaultFactory hands both services the
    // same underlying FileStorage instance (and its one commit queue).
    const serviceA = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const serviceB = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });

    await serviceA.write('shared.md', 'from A, pending commit');
    await serviceA.close();

    // If closing A had cleared the shared backend's queue, this would be a
    // silent no-op and shared.md would never actually get committed.
    await serviceB.drainQueue();

    const { stdout } = await execFileAsync('git', ['log', '--name-only', '--format='], { cwd: tmpDir });
    expect(stdout).toContain('shared.md');
  });
});

describe('VaultService.close() idempotency (regression)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-idempotent-test-'));
    await initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a second close() does not release a reference this service was never granted', async () => {
    const serviceA = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const serviceB = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });

    // B has a PENDING (not yet committed) queued write before A's redundant
    // second close() — this is what actually exposes a double-release:
    // close() only clears the queue, so a functional write-then-drain on B
    // would look fine either way unless something was already queued and
    // waiting when the (wrongly) extra release evicted the shared backend.
    await serviceB.write('still-owned-by-b.md', 'content');

    await serviceA.close();
    await serviceA.close(); // must be a no-op, not a second release

    // If the second close() had released an extra reference, the shared
    // backend would be evicted+closed here, silently clearing B's still-
    // pending write out of the queue before it ever got committed.
    await serviceB.drainQueue();

    const { stdout } = await execFileAsync('git', ['log', '--name-only', '--format='], { cwd: tmpDir });
    expect(stdout).toContain('still-owned-by-b.md');
  });

  it('switchBackend() throws on an already-closed service instead of acquiring a new backend', async () => {
    const service = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    await service.close();

    const otherDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-idempotent-test-other-'));
    try {
      await expect(service.switchBackend({ backend: 'file', options: { rootPath: otherDir } })).rejects.toThrow(
        'closed',
      );
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('VaultService rejects operations after close() (regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-closed-ops-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects read/write/getBackend after close() instead of operating on a possibly-evicted backend', async () => {
    const service = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    await service.close();

    // Without this guard, a closed-but-still-called service can keep
    // reading/writing through a backend VaultFactory already evicted, while
    // an unrelated later create() for the same vault gets a fresh backend
    // with its own queue — two independent queues racing the same git
    // working tree.
    await expect(service.read('x.md')).rejects.toThrow('closed');
    await expect(service.write('x.md', 'y')).rejects.toThrow('closed');
    expect(() => service.getBackend()).toThrow('closed');
  });
});

describe('VaultService.close() retry after backend.close() failure (regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-close-retry-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not mark the service closed if the backend rejects, so a retry can actually retry', async () => {
    const service = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const closeSpy = vi.spyOn(service.getBackend(), 'close').mockRejectedValueOnce(new Error('simulated close failure'));

    await expect(service.close()).rejects.toThrow('simulated close failure');

    // Not marked closed — a data operation must still work, not throw
    // "VaultService is closed".
    await expect(service.read('anything.md')).resolves.toBeNull();

    // The mocked rejection was "once"; this retry calls the real close().
    // Asserting the resolved value alone wouldn't distinguish a genuine
    // retry from a silent no-op (both just resolve without throwing) — the
    // call count is what actually proves backend.close() ran a second time.
    await expect(service.close()).resolves.toBeUndefined();
    expect(closeSpy).toHaveBeenCalledTimes(2);
    closeSpy.mockRestore();
  });
});

describe('VaultFactory concurrent create() during a slow close() (regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-close-race-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('gets a genuinely fresh instance, never the one being torn down', async () => {
    const service = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const closingBackend = service.getBackend();

    let closeCalled = false;
    let resolveClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    vi.spyOn(closingBackend, 'close').mockImplementation(() => {
      closeCalled = true;
      return closeGate;
    });

    const closePromise = service.close(); // enqueues the close op; hasn't run yet

    // service.close() only SCHEDULES its work via .then() — the actual
    // backend.close() call happens several microtask hops later, not
    // synchronously here. Yield until it's actually been reached, so the
    // "concurrent create()" below is a genuine race, not a no-op because
    // close() hadn't started (which would leave the old instance cached
    // and make this assertion pass for the wrong reason).
    while (!closeCalled) {
      await Promise.resolve();
    }

    // Now that close() is genuinely in flight, a fresh create() for the
    // SAME config must not receive the instance that's mid-teardown — it
    // should build (and get) a genuinely new one.
    const freshService = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    expect(freshService.getBackend()).not.toBe(closingBackend);

    resolveClose();
    await closePromise;
  });
});

describe('VaultFactory.release() ties retries to a specific instance (regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultfactory-retry-identity-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not misattribute a fresh instance\'s release as a retry of a different, still-parked instance', async () => {
    const serviceA = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const backendX = serviceA.getBackend();
    const closeXSpy = vi.spyOn(backendX, 'close').mockRejectedValueOnce(new Error('X failed to close'));

    await expect(serviceA.close()).rejects.toThrow('X failed to close');
    expect(closeXSpy).toHaveBeenCalledTimes(1);
    // X is now parked as a failed-to-close instance, retryable by cache key.

    const serviceB = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const backendY = serviceB.getBackend();
    expect(backendY).not.toBe(backendX); // B genuinely got a fresh instance

    const closeYSpy = vi.spyOn(backendY, 'close');

    // Without matching by instance (not just cache key), this would find X
    // parked under the same key and "retry" closing X instead of ever
    // touching Y — Y's own reference count would never decrement.
    await serviceB.close();
    expect(closeYSpy).toHaveBeenCalledTimes(1);
    expect(closeXSpy).toHaveBeenCalledTimes(1); // still just the one failed attempt

    // A's own retry must still find X (untouched by B's close()) and
    // actually retry it — proving B's close() didn't consume A's retry.
    await expect(serviceA.close()).resolves.toBeUndefined();
    expect(closeXSpy).toHaveBeenCalledTimes(2);
  });
});

describe('VaultService.create() failed-initialize reference leak (regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-leak-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not leave a phantom reference behind when initialize() rejects', async () => {
    const rootPath = join(tmpDir, 'vault');
    // A FILE sits exactly where rootPath needs to be a directory, so
    // FileStorage.initialize()'s mkdir(rootPath, {recursive:true}) rejects.
    writeFileSync(rootPath, 'blocking file');

    await expect(VaultService.create({ backend: 'file', options: { rootPath } })).rejects.toThrow();

    rmSync(rootPath); // clear the obstruction
    const service = await VaultService.create({ backend: 'file', options: { rootPath } });
    const firstBackend = service.getBackend(); // captured before close() — closed services reject getBackend()
    await service.close();

    // If the failed attempt above had leaked a reference, this close() only
    // brings the count from 2 down to 1 (not 0), so the backend never
    // actually evicts — a fresh create() with the same config would still
    // return that same, never-evicted instance instead of a new one.
    const service2 = await VaultService.create({ backend: 'file', options: { rootPath } });
    expect(service2.getBackend()).not.toBe(firstBackend);
  });
});
