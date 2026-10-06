# Release Process

The canonical sequence for cutting a toto-wolff release. `CONTRIBUTING.md`'s
"Governance" section describes what `/cabinet` and `/council` are for; this
file is the ordered runbook that puts them in context with the rest of the
steps. Whoever cuts the release (human or agent) should follow this sequence
in order and get explicit sign-off before each step marked **confirm**.

## Sequence

1. **Branch.** Cut the release branch from `main`. For 2.0.0, cut
   `release/v2.0.0` from `v2` (the 2.0 integration branch); the release PR
   targets `main` and merges with a merge commit.

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

4. **Sync the plugin.** `pnpm sync:plugin` copies every skill that
   `plugin/.claude-plugin/plugin.json` lists from `.claude/skills/` into
   `plugin/skills/`, copies the root `LICENSE` to `plugin/LICENSE`, checks
   the result (layout, file sizes, no minified file, no lockfile, the icon),
   and stages `plugin/` with `git add`. The server under `plugin/server/` is
   readable `.mts` source that Node runs directly, so nothing is built.
   `plugin/` is the only thing the plugin ships, so the committed copy has
   to already be what the source produces. Review the staged diff before folding it into the release
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
   - **Manual checks (2.0 and later), before `/cabinet`:** run the
     interactive `graph-run` smoke check and record the result in the
     release PR. In a scratch git repo, start
     `claude --plugin-dir <repo>/plugin` in the default permission mode,
     run `/toto-wolff:graph-run` on idea-to-pr with `stopAt: "adr"`, and
     confirm that it asks you at the approve-ruling gate, that the
     `graph_approve` call shows a permission prompt, and that the ADR lands
     at `docs/adr/0001-<slug>.md`. CI cannot do this, because it needs a
     person to answer (spec criterion 12; Safety Car S8 for #63). A release
     without it recorded does not go to `/cabinet`.
   - **The merge is the release for existing users (2.0 and later).** The
     marketplace on `main` serves `./plugin`, so merging the release PR
     updates every marketplace install at once, before the tag, the publish
     and portal Validate. So before `/cabinet`, also record in the release
     PR:
     - **The upgrade path.** In a throwaway HOME (`HOME=$(mktemp -d)`), add
       the marketplace from `main` and install the previous release, then
       point the marketplace at a fresh `git worktree` of the release
       commit (`git status --porcelain` empty), run
       `claude plugin marketplace update` and `claude plugin update`, and
       check `claude mcp list` shows the server Connected with every tool.
       If an upgrade cannot be simulated, say so in the PR.
     - **Portal Validate on a staging copy.** Just before the merge, build
       branch `plugin-staging` from the final release commit with
       `bash scripts/publish-plugin.sh vX.Y.Z plugin <checkout>`, compare
       its tree with the release commit's `plugin/` tree, push it with
       `git -C <checkout> push origin HEAD:refs/heads/plugin-staging`
       (**confirm**), run Validate on it in the portal, record the result,
       and delete `plugin-staging` afterwards.
     - CI green on the release PR, including the required checks
       `typecheck-and-test` and `secret-scan`.

7. **Run `/cabinet "<release description>" vX.Y.Z`** (**confirm**). All three
   seats (Garry Tan, Richard Feynman, Andrej Karpathy) must vote to ship.
   - **SHIP**: proceed to step 8.
   - **CONDITIONAL**: meet every listed condition first, check each one off
     in the Cabinet record with the commit that meets it, and get CI green on
     that commit. Only then proceed to step 8.
   - **BLOCK**: a seat named a specific release-critical defect. Fix it,
     re-run the Karpathy check against the affected stage, and re-convene
     Cabinet on the fix before proceeding.

8. **Merge the PR** (**confirm**). This is the point of no return for
   marketplace users: the merge updates them. A revert PR only stops further
   updates; the real rollback is a version-bumped forward fix (x.y.z+1).

9. **Tag the merge commit** `vX.Y.Z` (**confirm**: get the explicit
   go-ahead before tagging specifically, even after the merge itself was
   already approved). The publish workflow refuses a tag that is not on
   `main` or does not match `VERSION`.

10. **Dry-run the publish** (**confirm**). Run the `Publish plugin` workflow
    by hand with `tag: vX.Y.Z` and `dry_run: true`. Check its log: the gate
    passed, the commit it would add to branch `plugin` (`release vX.Y.Z`,
    its file list), the tag's SHA, and `git push --dry-run` succeeding.

11. **Publish the GitHub release** for `vX.Y.Z` (**confirm**), on the same
    tag SHA the dry run showed (do not move the tag). The release starts
    the workflow, which commits `release vX.Y.Z` onto branch `plugin` with
    a plain push. If the push fails, fix the cause and run the workflow by
    hand with the same tag (it is safe to repeat). Run one publish at a
    time.

12. **Validate branch `plugin`** in the plugin directory portal once
    `release vX.Y.Z` is on it, and record the findings in the vault run
    record. Then the directory submission (it tracks branch `plugin`).

## Rolling back the plugin branch

Run the `Publish plugin` workflow by hand with an older tag. It commits that
tag's `plugin/` onto branch `plugin` as a new forward commit (history is
kept, nothing is forced). That older tag carries a lower `version`, so
installed copies may not move back until they reinstall; the real fix is a
new release with a higher version.

## Why steps 6 to 12 are separately gated

Pushing the release commit, running `/cabinet`, merging, and tagging are the
points in this sequence with no automated undo: a push is visible to CI and
any watchers, `/cabinet` is the release gate itself and shouldn't be run on
evidence nobody's checked, and a merge, a tag, a published release or a
commit on branch `plugin` is what actually makes a release real. Everything before step 6 (branching, bumping, syncing dist,
local verification) is local and reversible, so it doesn't need the same
pause.
