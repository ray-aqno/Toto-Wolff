import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const VERSION_FILE = resolve(REPO_ROOT, 'VERSION');
const PACKAGE_DIRS = ['.', 'packages/core', 'packages/cli', 'packages/mcp-server', 'packages/dashboard', 'packages/personas'];

/**
 * All package.json versions track the root VERSION file in lockstep — this
 * repo ships as one monorepo release, not independently-versioned packages
 * (none of them are published to npm; VERSION is what matches CHANGELOG.md
 * and git tags). Run with no args to sync package.json files to VERSION, or
 * `tsx scripts/bump-version.ts <new-version>` to also bump VERSION first.
 */
function main(): void {
  const arg = process.argv[2];
  if (arg !== undefined) {
    // R5 assertion: new version must look like semver before writing anything
    if (!/^\d+\.\d+\.\d+$/.test(arg)) {
      console.error(`bump-version: "${arg}" is not a valid semver (expected x.y.z)`);
      process.exit(1);
    }
    writeFileSync(VERSION_FILE, `${arg}\n`);
  }

  if (!existsSync(VERSION_FILE)) {
    console.error(`bump-version: ${VERSION_FILE} not found`);
    process.exit(1);
  }
  const version = readFileSync(VERSION_FILE, 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`bump-version: VERSION file contains invalid semver "${version}"`);
    process.exit(1);
  }

  // P10-R2 LOOP BOUND: fixed-length array, ≤ 6 iterations
  for (const dir of PACKAGE_DIRS) {
    const pkgPath = resolve(REPO_ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      console.error(`bump-version: ${pkgPath} not found — update PACKAGE_DIRS`);
      process.exit(1);
    }
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    pkg['version'] = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`bump-version: ${dir}/package.json -> ${version}`);
  }

  console.log(`bump-version: synced ${PACKAGE_DIRS.length} package.json files to VERSION ${version}`);
}

main();
