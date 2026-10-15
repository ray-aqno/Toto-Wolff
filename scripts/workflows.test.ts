// Properties of the GitHub workflows (#64), checked as text: the runner image
// is pinned, and the publish workflow keeps its write token away from
// installed code, never forces, and only reads its inputs through env.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const read = (name: string): string => readFileSync(join(WORKFLOWS, name), 'utf8');

describe('every workflow', () => {
  it('pins the runner image (ubuntu-latest moves to Ubuntu 26 on Oct 19, 2026)', () => {
    for (const name of readdirSync(WORKFLOWS).filter((n) => n.endsWith('.yml'))) {
      expect(read(name), name).not.toContain('ubuntu-latest');
    }
  });
});

describe('publish-plugin.yml', () => {
  const yml = read('publish-plugin.yml');
  const jobs = yml.slice(yml.indexOf('\njobs:'));
  const gate = jobs.slice(jobs.indexOf('\n  gate:'), jobs.indexOf('\n  publish:'));
  const publish = jobs.slice(jobs.indexOf('\n  publish:'));

  it('runs on a published release and on a manual dispatch with a tag and dry_run', () => {
    expect(yml).toMatch(/release:\n\s+types: \[published\]/);
    expect(yml).toMatch(/workflow_dispatch:[\s\S]*tag:[\s\S]*dry_run:/);
  });

  it('never forces and pushes only to the explicit plugin ref', () => {
    expect(yml).not.toMatch(/--force|\s-f\s|\+refs/);
    expect(publish).toContain('push origin HEAD:refs/heads/plugin');
    expect(publish).toContain('push --dry-run origin HEAD:refs/heads/plugin');
  });

  it('gives write access to the publish job only, and installs nothing there (Arbiter condition 2)', () => {
    expect(yml).toMatch(/^permissions:\n\s+contents: read/m);
    expect(gate).toMatch(/permissions:\n\s+contents: read/);
    expect(publish).toMatch(/permissions:\n\s+contents: write/);
    expect(publish).not.toMatch(/pnpm|npm |yarn|action-setup/);
    expect(gate).toContain('pnpm check:plugin-sync');
    expect((yml.match(/persist-credentials: false/g) ?? []).length).toBe(2);
  });

  it('reads inputs and the release tag through env only, never inside shell text (Arbiter condition 3)', () => {
    const lines = yml.split('\n').filter((l) => /\$\{\{\s*(inputs\.|github\.event\.release)/.test(l));
    expect(lines.map((l) => l.trim())).toEqual([
      'INPUT_TAG: ${{ inputs.tag }}',
      'RELEASE_TAG: ${{ github.event.release.tag_name }}',
      'DRY_RUN: ${{ inputs.dry_run }}',
    ]);
  });

  it('checks the tag is on main and matches VERSION, with full history (Arbiter condition 4, Safety Car S4)', () => {
    expect(gate).toContain('fetch-depth: 0');
    expect(gate).toContain('git merge-base --is-ancestor HEAD origin/main');
    expect(gate).toContain('"v$(cat VERSION)" != "$TAG"');
    expect(publish).toContain('ref: ${{ needs.gate.outputs.sha }}');
  });

  it('masks the push token and keeps it out of argv (Safety Car S2, R2-6)', () => {
    expect(publish).toContain('echo "::add-mask::$basic"');
    expect(publish).toContain('GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $basic"');
    expect(yml).not.toContain('set -x');
  });
});
