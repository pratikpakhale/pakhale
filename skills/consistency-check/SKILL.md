---
name: consistency-check
description: Audit a set of changes (a branch, PR, or working tree) for consistency with the codebase's established conventions across many dimensions — code idioms, UI/visual, design tokens, i18n/copy, state & data-flow, architecture/layering, API/types, naming, and accessibility — by fanning out parallel sub-agents, one per dimension. Each agent measures how prevalent a convention actually is before flagging, so accepted dual-conventions are not reported as defects. Use when the user asks to check consistency, audit a diff/PR against existing patterns, "find every inconsistency", or sanity-check a feature branch before merge.
---

# Consistency check

Fan out sub-agents to compare a diff against the codebase's *own* established
conventions, then verify and classify each finding before reporting. The point is
a high-signal report, not a pile of cosmetic nits.

## The four rules (read before anything else)

1. **Scope to the diff.** Only code the change *introduced or touched* is in scope.
   Never flag pre-existing untouched code. Identify unrelated/concurrent working-tree
   changes (other people's in-flight work) and exclude them explicitly.
2. **Measure before flagging.** A convention is only "the" convention if it dominates.
   Count *both* forms (`grep -c`) in the existing codebase. If both are widely used
   (e.g. Tailwind `size-4` 219× vs `h-4 w-4` 349×), it is an **accepted dual-convention** —
   NOT a finding. Most false positives die here.
3. **Verify against source.** Read the actual lines before reporting. A finding needs
   `file:line`, the deviation, the established alternative, and its prevalence count.
4. **Classify and justify.** Every candidate ends as Genuine / False-positive / Out-of-scope
   with a one-line reason. Report skips too — silent omission reads as "all clear".

## Workflow

1. **Scope the diff** (inline, deterministic):
   - `base=$(git merge-base <base-branch> HEAD)`
   - `git diff --stat $base...HEAD` and `git status --short` → changed + untracked files.
   - Separate *this change* from unrelated concurrent edits. Carry the in-scope file list forward.
2. **Fan out one agent per dimension.** Use [DIMENSIONS.md](DIMENSIONS.md) as the catalog.
   - If the user has opted into orchestration (this skill counts as opt-in for a review
     workflow), run [scripts/consistency-workflow.js](scripts/consistency-workflow.js) via the
     Workflow tool, passing `args: { base, changedFiles, repo }` — add `only: [<keys>]` to run a
     subset of dimensions. It pipelines review → adversarial verify → synthesize.
   - Otherwise fan out with the Agent tool (`Explore` for find, default for verify), one per
     dimension, in a single message so they run in parallel.
   - Each find-agent: learn the convention + prevalence from the **existing** code, then inspect
     **only** the changed files, returning structured findings (file:line, deviation, established
     form + count, severity, confidence).
3. **Adversarially verify each candidate.** A second agent reads the source and confirms it is
   (a) introduced by the diff, (b) a genuine deviation and not an accepted dual-convention
   (re-measure), (c) in scope. Default to *refuted* when uncertain.
4. **Synthesize.** Dedup by file+line across dimensions. Rank by severity:
   correctness > behavior parity > i18n/a11y gap > naming > cosmetic.
5. **Report** (default). Apply fixes only if the user asks. When fixing, never churn a cosmetic
   dual-convention, and prefer fixing at the source over downstream remapping.

## Severity ladder

- **correctness** — wrong behavior/output, broken types, wrong copy a user sees.
- **behavior parity** — same operation done differently than its siblings (e.g. one code path
  derives a value with a fallback that another omits).
- **i18n / a11y gap** — hardcoded user-facing/screen-reader string in an otherwise localized app;
  missing locale key; untranslated `aria-label`.
- **naming / structure** — module placed in the wrong layer, type living far from its use,
  helper reinvented instead of imported.
- **cosmetic** — interchangeable with an equally-common existing form. Usually *not* worth a fix;
  only flag when it breaks consistency *within the same new feature*.

## Output shape

```
## Consistency report — <branch> vs <base>  (N files in scope)
### Genuine (ranked)
- [severity] file:line — <deviation>; codebase uses <established> (Mx vs Nx). Fix: <one line>
### False positives (measured, not defects)
- file:line — <form> is an accepted dual-convention (Mx vs Nx). No change.
### Out of scope
- file — unrelated concurrent change / pre-existing. Untouched.
```

See [DIMENSIONS.md](DIMENSIONS.md) for the per-dimension checklists and grep recipes.
