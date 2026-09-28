import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeDistPath, PACKAGES } from './check-dist-sync.js';

describe('assertSafeDistPath', () => {
  it('returns the real dist path for each known package under the real repo root', () => {
    for (const pkg of PACKAGES) {
      expect(assertSafeDistPath(pkg)).toMatch(new RegExp(`packages[\\\\/]${pkg}[\\\\/]dist$`));
    }
  });

  it('refuses when packages/<pkg>/dist already exists as a symlink, rather than deleting through it', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'check-dist-sync-test-'));
    try {
      const pkgDir = join(scratch, 'packages', 'core');
      mkdirSync(pkgDir, { recursive: true });
      const realTarget = join(scratch, 'somewhere-else-entirely');
      mkdirSync(realTarget);
      symlinkSync(realTarget, join(pkgDir, 'dist'));

      expect(() => assertSafeDistPath('core', scratch)).toThrow(/symlink/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('does not throw when packages/<pkg>/dist does not exist yet at the given root (nothing to refuse)', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'check-dist-sync-test-'));
    try {
      expect(() => assertSafeDistPath('mcp-server', scratch)).not.toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('PACKAGES', () => {
  it('is exactly core and mcp-server, in build order (core must build before mcp-server)', () => {
    expect(PACKAGES).toEqual(['core', 'mcp-server']);
  });
});

// The git-status-based comparison logic (compareAgainstCommitted) and the
// rebuild-with-tsbuildinfo-cleanup logic (rebuildPackage/runRebuild) are
// integration-level: they shell out to real git and pnpm build against this
// repo's actual working tree. Rather than mock those subprocess calls, this
// session verified both documented fail-open cases directly against the real
// tree before committing:
//   - a new source file whose compiled output was never committed showed up
//     as an untracked file under dist/ and was correctly flagged
//   - a source file deleted after its output was committed left that output
//     as a git-tracked-but-now-missing (deleted) path and was correctly
//     flagged
// Both were confirmed to make check-dist-sync exit 1 with the drifted paths
// named, and confirmed to exit 0 again once reverted. See the Stage 3 commit
// message for the exact commands run.
