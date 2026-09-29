# Release Process

The canonical sequence for cutting a toto-wolff release. `CONTRIBUTING.md`'s
"Governance" section describes what `/cabinet` and `/council` are for; this
file is the ordered runbook that puts them in context with the rest of the
steps. Whoever cuts the release (human or agent) should follow this sequence
in order and get explicit sign-off before each step marked **confirm**.

## Sequence

1. **Branch.** Cut the release branch from `main`.

2. **Bump the version.** `pnpm bump-version <x.y.z>` writes the root `VERSION`
   file and syncs it into the four `package.json` files that track it in
   lockstep (root, `packages/core`, `packages/cli`, `packages/mcp-server`).
   None of these packages publish to npm independently; `VERSION` is what
   has to match `CHANGELOG.md` and the eventual git tag. `bump-version`
   does not touch the plugin manifest: set `"version"` in
   `plugin/.claude-plugin/plugin.json` to the same number by hand. Installed
   copies and the plugin directory key updates on that field, so a release
   that changes the plugin without raising it may never reach existing
   installs.

3. **Expand `CHANGELOG.md`.** Add a dated `## [x.y.z]` section under
   `Keep a Changelog` conventions, in the same depth and voice as the
   existing entries: what shipped, why it's safe, what changed and why.

4. **Sync the plugin.** `pnpm sync:plugin` rebuilds the minified server
   bundle `plugin/server/index.mjs` from clean, copies every skill that
   `plugin/.claude-plugin/plugin.json` lists from `.claude/skills/` into
   `plugin/skills/`, checks the result, and stages `plugin/` with `git add`.
   `plugin/` is the only thing the plugin ships, launched with no build step
   at install time, so the committed copy has to already be what the source
   produces. Review the staged diff before folding it into the release
   commit; don't run this and then ignore what it staged. This step has to
   happen before `/cabinet`, not after, so the reviewers in that gate see
   the real `plugin/` diff along with everything else.

5. **Local verification**, all of it, before pushing:
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm -r test`
   - the lint-baseline gate: `pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/check-eslint-baseline.ts`.
     Don't use raw `pnpm lint` as the pass/fail signal: it exits non-zero on
     the violations already recorded in `.eslint-baseline.json`. The gate
     fails only on new ones, and it is what CI runs.
   - `pnpm check-patterns`
   - `claude plugin validate plugin --strict`
   - `pnpm check:plugin-sync`, run after the release commit (including
     step 4's staged `plugin/`) is committed. It treats any uncommitted change
     under `plugin/`, staged or not, as drift, so it fails if run between
     `pnpm sync:plugin` and the commit even when the output is correct. If it
     fails after the commit, re-run `pnpm sync:plugin`, review, and amend or
     add a commit before continuing.

6. **Push the release commit** (**confirm**). Watch CI to green, including
   the `plugin-launch-smoke-test` job and the lint-baseline job's
   `check:plugin-sync` step. Read Greptile's
   review comments; they're data to act on, not a gate to wait out.

7. **Run `/cabinet "<release description>" vX.Y.Z`** (**confirm**). All three
   seats (Garry Tan, Richard Feynman, Andrej Karpathy) must vote to ship.
   - **SHIP**: proceed to step 8.
   - **CONDITIONAL**: meet every listed condition first, check each one off
     in the Cabinet record with the commit that meets it, and get CI green on
     that commit. Only then proceed to step 8.
   - **BLOCK**: a seat named a specific release-critical defect. Fix it,
     re-run the Karpathy check against the affected stage, and re-convene
     Cabinet on the fix before proceeding.

8. **Merge the PR** (**confirm**), then **tag the merge commit**
   (**confirm**: get the explicit go-ahead before tagging specifically,
   even after the merge itself was already approved).

## Why steps 6, 7, and 8 are separately gated

Pushing the release commit, running `/cabinet`, merging, and tagging are the
points in this sequence with no automated undo: a push is visible to CI and
any watchers, `/cabinet` is the release gate itself and shouldn't be run on
evidence nobody's checked, and a merge or a tag is what actually makes a
release real. Everything before step 6 (branching, bumping, syncing dist,
local verification) is local and reversible, so it doesn't need the same
pause.
