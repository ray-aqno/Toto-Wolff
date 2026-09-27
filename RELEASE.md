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
   has to match `CHANGELOG.md` and the eventual git tag.

3. **Expand `CHANGELOG.md`.** Add a dated `## [x.y.z]` section under
   `Keep a Changelog` conventions, in the same depth and voice as the
   existing entries: what shipped, why it's safe, what changed and why.

4. **Sync `dist/`.** `pnpm sync:dist` deletes and rebuilds
   `packages/core/dist` and `packages/mcp-server/dist` from current source
   and stages the result with `git add`. Both directories ship committed
   because the plugin launches `node packages/mcp-server/dist/index.js`
   directly, with no build step at install time: the committed output has
   to already be what the source produces. Review the staged diff before
   folding it into the release commit; don't run this and then ignore what
   it staged. This step has to happen before `/cabinet`, not after, so the
   reviewers in that gate see the real `dist/` diff along with everything
   else.

5. **Local verification**, all of it, before pushing:
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm -r test`
   - `pnpm lint`
   - the lint-baseline gate: `pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/check-eslint-baseline.ts`
   - `pnpm check-patterns`
   - `pnpm check:dist-sync`, which confirms step 4's committed `dist/` still
     matches a fresh rebuild; if it doesn't, re-run `pnpm sync:dist` and
     re-review before continuing

6. **Push the release commit** (**confirm**). Watch CI to green, including
   the `plugin-launch-smoke-test` and `check:dist-sync` jobs. Read Greptile's
   review comments; they're data to act on, not a gate to wait out.

7. **Run `/cabinet "<release description>" vX.Y.Z`** (**confirm**). All three
   seats (Garry Tan, Richard Feynman, Andrej Karpathy) must vote to ship.
   - **SHIP or CONDITIONAL**: proceed to step 8.
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
