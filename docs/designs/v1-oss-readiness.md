# toto-wolff v1.0.0 OSS Readiness — Design Document

**Author:** Toto Wolff engineering session  
**Date:** 2026-06-25  
**Status:** Draft — pending /plan-eng-review  
**Cabinet Record:** `Cabinet/2026-06-25-toto-wolff-v1-oss-product-scope.md`

---

## Problem

The Cabinet ruled RELEASE HELD on v1.0.0 (2026-06-25). Feynman BLOCKS. Root cause: the core
product claim — confidence-gated plan execution from team history — has never executed end-to-end
against real data. `~/.toto/vault/Signals/` = 0 records on every fresh install. The README presents
this as a working feature. It is not.

Secondary defects confirmed by Cabinet:
- 3 of 4 personas are `# STUB`
- README implies team shared memory; vault is single-user local storage
- `scoreConfidence` thresholds set analytically, never validated against real corpus
- Dashboard empty-state copy missing; new install looks broken, not "no data yet"

This document defines what needs to be built and changed so every claim in README and CHANGELOG is
true at the moment of v1.0.0 tagging. Nothing beyond that.

---

## Target User

Staff or principal engineer at a mid-size startup (10–200 engineers). Already using Claude Code daily.
Pain: architectural decisions made in Claude sessions disappear when the session closes. The team
re-debates the same questions. Junior engineers can't find prior rulings. Senior engineers get pulled
into repeat discussions.

The "whoa" moment: running `/council` on an architecture decision and getting back a Congressional
Record the whole team can read. Then, two weeks later, a new plan gets checked against that record
automatically — and the plan is modified because the prior ruling is HIGH confidence.

That second part — the automatic check and modification — has never actually fired.

---

## Competitive Context

[claude-mem](https://github.com/thedotmack/claude-mem) has 74.8K GitHub stars (June 2026). It
captures raw session state (tool calls, code changes), compresses with AI, and injects context into
future sessions. Market validation: developers want persistent AI memory. Strong.

toto-wolff's differentiation is not session replay — it's structured, veto-capable governance. The
claim is: `scoreConfidence` reads past deliberation records and can veto a new plan that contradicts
them. claude-mem can't do that. But we only have that differentiation if the signal loop actually
fires. Right now it doesn't.

---

## Gap Analysis: README Claims vs. Reality

| Claim | Reality at v0.3.0 | Gap |
|-------|-------------------|-----|
| Signal loop carries past rulings forward | Code exists, never run on real data | Run backfill against real corpus; verify HIGH fires |
| Confidence-gated plan execution | `scoreConfidence` always LOW on fresh install | Cold-start warning + backfill path in `./setup` |
| Role-based governance (4 personas) | 3 of 4 personas are `# STUB` | Write real content for devops, data, r-and-d personas |
| Team shared memory | Single-user local vault | Remove/scope this claim in README |
| `scoreConfidence` thresholds are correct | Set analytically (N_DISTINCT=2, Jaccard=0.5) | Validate against real ADR/P10 corpus; adjust if needed |
| Dashboard shows governance health | Empty state shows blank charts | Write empty-state copy for all 4 dashboard panels |

---

## What Must Be Built for v1.0.0

### S1: Signal Loop Smoke Test (P0 — blocks Cabinet flip)

Run `toto backfill` against the real `~/.toto/vault/` corpus (ADRs + P10 plans). Verify that at
least one signal reaches `confidence_tier: HIGH`. Record the actual Jaccard scores observed on real
data. Adjust `JACCARD_MATCH_THRESHOLD` or `N_DISTINCT` if the corpus never produces HIGH — and if
adjustment is needed, that is a council ruling, not a silent constant change.

**Deliverable:** One verified HIGH signal in `~/.toto/vault/Signals/`. One integration test that
seeds real-format records and asserts HIGH fires. The test corpus must match the actual vault
frontmatter schema, not synthetic records.

**Risk:** If real ADR topic_tags are too sparse or dissimilar (low Jaccard), the threshold may need
to drop. This would require re-running the confidence-scoring council ruling. Account for 1 council
session if the corpus is hostile to the current threshold.

### S2: Cold-Start Warning in `score_confidence` MCP Tool (P0)

When `Signals/` directory is empty, `score_confidence` currently returns LOW with a disqualifier
"fewer than 2 distinct records." That is technically correct but useless on fresh install. The user
has no idea they need to run `toto backfill`.

Change: when `matchCount === 0` AND `Signals/` is empty (new param: `signalDirEmpty: boolean` from
the caller), emit an additional disqualifier string: `"Signal store is empty — run 'toto backfill'
to seed from your council and p10 history before using confidence-gated execution."` 

This is a one-line addition to `scoreConfidence.ts` plus a signal-dir check in the MCP handler. No
architecture change.

### S3: `toto backfill` in `./setup` Flow (P0)

New install → `./setup` → vault dirs created → no signals seeded → signal loop permanently dark.

Fix: add a backfill step to `./setup` that runs after vault dir creation. Step should:
1. Check if `~/.toto/vault/Signals/` already has records (skip if yes)
2. Check if council/p10 dirs have any files (skip with a note if empty)
3. Run `toto backfill --quiet` if corpus exists
4. Print count of signals seeded

This makes the signal loop live on the first meaningful install, not after a manual step the user
has to discover in the README.

### S4: Persona Content — devops, data, r-and-d (P1)

`personas/devops.md`, `personas/data.md`, `personas/r-and-d.md` are `# STUB`. The setup guard
(fail-closed) already prevents using stub personas — which means 3 of 4 roles are completely
non-functional in a v1.0.0 install.

Options:
- A) Write real content for all 3 (2–4h per persona of genuine engineering). Ship all 4 at v1.0.0.
- B) Ship v1.0.0 with engineering persona only, explicitly scope README to "single-role at launch,
  more roles in v1.1.0." Remove stub files so the install doesn't surface empty personas.

Recommendation: B. Shipping 3 stubs is worse than shipping 1 complete persona with an honest scope
statement. Remove `data.md`, `devops.md`, `r-and-d.md` from the repo at v1.0.0. Update README to
say "v1.0.0 ships with the engineering persona; additional roles ship in v1.1.0." The fail-closed
guard already protects against broken installs.

If the author wants to write all 4 personas before tagging, option A unblocks the Cabinet on this
point. But the scope must be explicit.

### S5: README Scope Correction — Team Memory (P1)

Exact claim to remove or scope:
> "engineers start from zero on every session — toto-wolff closes that loop"

This is true for a single engineer's own sessions. It is NOT true for a team: vault is local,
not shared. Replace with: "Your own deliberation history persists across sessions. Shared team
vault is roadmapped for v1.1.0."

Also add to the API cost section: full `/council` chain costs ~$0.10–0.30 per session. Add a note
before the first example so users know what they're signing up for before running it.

### S6: Dashboard Empty-State Copy (P2)

Four panels, four empty states. Write and wire these strings into `dashboard_html.ts` before v1.0.0:

| Panel | Empty state copy |
|-------|-----------------|
| Decision velocity | "No sessions yet — run /council to start your first." |
| Reversal rate | "No reversals recorded yet." |
| P10 compliance | "No p10 plans yet — run /p10 to start." |
| Role adoption | "No personas active — run `toto setup` to configure your role." |

This is a ~30-minute code change in `packages/mcp-server/src/dashboard_html.ts` and
`packages/dashboard/`. Not blocking but a real UX defect on fresh install.

---

## Success Criteria for v1.0.0

Cabinet will flip from HELD to APPROVED when all of these are true:

1. `toto backfill` run against real corpus returns at least 1 HIGH signal — verified and logged
2. Cold-start warning fires in `score_confidence` when Signals/ is empty
3. `./setup` includes backfill step — verified with a new-clone test
4. README team-memory claim removed or scoped to single-user
5. Either all 4 personas have real content, OR v1.0.0 scopes to engineering-only + stubs removed
6. Dashboard empty-state copy present and rendering
7. API cost note added to README
8. All existing tests pass: `pnpm -r test` clean
9. Typecheck clean: `pnpm -r typecheck`

---

## Out of Scope for v1.0.0

- Shared team vault (v1.1.0)
- GitHub Actions auto-trigger for `/council` on PR (T2, blocked on shared vault)
- Linear sync integration (T8, spec not written)
- `toto-report` analytics (T7, depends on T8 baseline)
- Decision reversal auto-detection (T5, needs volume)
- Fast-path council queries (T10, post-baseline optimization)
- Additional personas beyond engineering (unless S4-A is chosen)

---

## Version Decision

**Tag v1.0.0 only when all S1–S3 are done and S4/S5 choices are implemented.** S6 is P2 but
should be done in the same sprint — it's 30 minutes and makes the first-run experience honest.

If S1 fails (real corpus never produces HIGH signal), re-run the confidence-scoring council ruling
before v1.0.0 and adjust thresholds. Do not tag v1.0.0 with a signal loop that is empirically
broken on the corpus it was built for.

If S4-B is chosen (engineering-only), tag v1.0.0 clearly scoped: "v1.0.0: engineering persona,
single-user vault, signal loop live."

Do not tag v0.4.0 as a workaround. The work in S1–S6 is correct regardless of version number —
do the work, then tag v1.0.0 honestly.

---

## Estimated Scope

| Item | Effort |
|------|--------|
| S1: Signal loop smoke test + integration test | 2h |
| S2: Cold-start warning in score_confidence | 30min |
| S3: backfill in ./setup | 1h |
| S4-B: Remove stub personas + README scope | 30min |
| S5: README team-memory correction + API cost note | 30min |
| S6: Dashboard empty-state copy | 30min |
| **Total** | **~5h** |

If S4-A (write all 3 stub personas), add 6–12h for genuine persona content authoring. That is
human writing time, not code time.
