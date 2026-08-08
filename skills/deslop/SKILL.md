---
name: deslop
description: "Clean up generated code changes — strip slop (dead code, one-use abstractions, redundant guards, comment noise, unnecessary effects), fix what the change broke, and report what can't be safely fixed. No unrelated changes. Use when the user says 'deslop', 'mdeslop', 'clean this up', 'review my changes', or after generating/modifying a chunk of code."
metadata:
  author: pratikpakhale
  version: "4.0.0"
---

# Deslop

Strip the slop out of the change just made, fix what it broke, report what you shouldn't
touch yourself. Fixing is the default — you are not writing a review.

## Rules

- **Scope is the diff.** Only code the change introduced or touched. Pre-existing code is
  off-limits unless this change actively broke it.
- **No unrelated changes.** No opportunistic refactors, renames, dep bumps, or reformatting.
- **Fix quietly, flag loudly.** Apply cleanups without narrating each one. Surface only what
  needed a judgment call you couldn't make.
- **Trace before deleting.** One `rg` for every symbol you're about to remove.

## Load what applies

Read the reference for every stack present in the diff, **before** starting the hunt:

| In the diff | Read |
| --- | --- |
| `.tsx`, React, Next.js, RSC | [references/react.md](references/react.md) |
| `.ts`, Node, Bun, backend TS | [references/typescript.md](references/typescript.md) |
| `.py` | [references/python.md](references/python.md) |

Nothing matches? Run the hunt below on its own — it's language-agnostic.

## The hunt

Four passes, in order. The map decides what counts as slop; the trace is where the real
bugs are.

### 1. Map — what was this change *for*?

Read the diff (`git diff`, plus untracked files) and write the change's intent as one
sentence. Keep it in front of you: **anything in the diff that doesn't serve that sentence
is a removal candidate.** Separate out unrelated in-flight edits now and leave them alone.

Cheap and worth it first: does the change actually do what it claimed? A feature that's
wired but never called, or a branch that can't be reached from any entry point, is the
biggest possible piece of slop.

### 2. Trace — what did it break?

The only pass where you read *outside* the diff. For every function, component, type,
constant, or table column the diff modified, `rg -w <name>` and read each call site.

Look for callers that assumed the old shape:

- return type widened/narrowed, or a field renamed
- a default value or optional param changed
- errors that used to throw now return `null` (or the reverse)
- shared state written by the new code and read somewhere else
- a component whose props changed but whose other usages weren't updated

Fix these. This is where regressions actually live.

### 3. Strip — read each hunk against these tells

Hunt for *tells*, not categories. Each one below is something you can literally see in the
diff, paired with the question that settles it.

**One-use abstraction.** Tell: a helper, hook, wrapper, interface, factory, or options
object with exactly one caller — or a wrapper that forwards its arguments unchanged.
Ask: if I inline this, what gets worse? Nothing → inline it.

**Dead weight.** Tell: a symbol the diff introduced. `rg -w` it — if the definition is the
only hit, it's dead. Same for exports nobody imports, params never read, branches whose
condition can't be true, and imports left behind by an edit.

**Impossible guard.** Tell: `if (!x)` where `x` is non-nullable, a `try/catch` that only
rethrows, a re-check of something the caller already checked, a fallback for a state the
type system forbids. Ask: write the concrete input that makes this branch fire. Can't? Delete it.

**Half-done work.** Tell: `TODO`, `FIXME`, stub returns, hardcoded values that should be
arguments, `catch {}` that swallows, error paths that log and continue as if nothing happened.
Finish it or flag it — never leave it silent.

**Comment noise.** Tell: a comment that restates the line under it, a JSDoc block repeating
the signature, section banners, `// Added for X` changelog notes, commented-out code.
Delete all of it. Keep only comments explaining a non-obvious *why*.

**Verbosity.** Tell: a 12-line block that's one expression, an intermediate variable used
once on the next line, an if/else assigning the same variable, repeated near-identical
blocks that differ by one value.
Ask: does the shorter form lose any clarity? No → shorten it.

**User-facing gap.** Tell: a new string literal rendered to a user in a project whose sibling
files call `t()` / `useTranslations`; a `catch` that renders the raw error object; a mutating
action with no pending or success state.
Ask: does someone on a slow connection, in another locale, hitting the failure path, see
something sensible?

**Doesn't look like the neighbors.** The highest-yield tell, and the one most often skipped —
don't judge the new code on its own, open the nearest sibling first and diff the shape. For
UI that means the sibling *screen*, not just the sibling file.

- Code: naming (`getX` vs `fetchX`, `handleY` vs `onY`), error handling, file placement,
  import order, reuse of the existing helper/type/constant instead of a fresh one.
- UI: a button/input/modal/table hand-rolled when the design system already exports one; a
  one-off `className` where the component takes a `variant`; raw hex/px/radius values where
  tokens exist; spacing off the project's scale; a different icon set; loading, empty, and
  error states shaped differently from the sibling screen's; copy in another voice
  (`Sign in` vs `Log In`, sentence case vs Title Case).

Ask: reading only the new lines, would someone who knows this repo think it came from here?
For UI, put the new screen next to its sibling — would a user notice two different people
built them?

### 4. Flag — what you must not fix yourself

Report these; don't act on them unless the user says to.

- **Security.** XSS from unsanitized input, hardcoded secrets or tokens, `eval` /
  `innerHTML` / `dangerouslySetInnerHTML`, a new endpoint or action with no auth guard,
  SQL/command injection, path traversal. Say what's exploitable and how — the fix is often
  a design decision.
- **Architecture.** Is this production-ready or a hack that gets rewritten in a month? Is a
  breaking change wired end-to-end or left half-migrated? Describe the better shape; don't build it.
- **Ambiguity.** Anything where the correct answer depends on intent you don't have.

## Large diffs

Above ~10 files or ~500 changed lines, fan out rather than reading serially.

1. Partition changed files into **disjoint** groups — by module or feature, keeping callers
   with their callees. Disjoint is load-bearing: two agents editing one file clobber each other.
2. Spawn one Agent per group in a single message. Give each: its file list, the intent
   sentence from pass 1, the reference file(s) for its stack, and the boundary — *fix only
   inside your files, report anything crossing the boundary back to me*.
3. Do pass 2 and the consistency tell yourself, across the whole diff, once they return.
   Cross-group breakage and duplicated logic are invisible from inside a partition.

Use a Workflow only if the user explicitly opted into orchestration ("use a workflow",
ultracode) — then pipeline each group through fix → verify and synthesize. Otherwise plain
Agent fan-out.

## Output

Short.

1. **Stripped** — what you removed and fixed, grouped, one line each.
2. **Flagged** — pass 4 findings, severity-ordered, each with `file:line`.
3. **Open questions** — only if a decision is genuinely yours to ask about.

No preamble, no restating the diff back.
