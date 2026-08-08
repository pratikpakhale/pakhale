# Consistency dimensions

One sub-agent per dimension. Each agent: (1) learn the established convention from the
**existing/unchanged** code and **measure prevalence with counts**, (2) inspect **only** the
changed files, (3) return findings with `file:line`, the deviation, the established form + its
count, severity, and confidence. Skip accepted dual-conventions. Pick the dimensions that fit the
stack — drop the irrelevant ones, add domain-specific ones.

For each dimension below: **Check** = what to look for · **Measure** = how to prove prevalence ·
**Common false positives** = things that look wrong but are accepted.

---

## 1. Code idioms
- **Check:** error handling shape (throw vs structured result), early-return vs nesting, async
  patterns, `for (;;)` vs `while (true)`, optional chaining/nullish style, import grouping &
  ordering, default vs named exports, `type` vs `interface`, **reuse of existing helpers instead
  of re-implementing them** (a private `formatBytes`/`clsx`/date helper that already exists centrally).
- **Measure:** `grep -rn` the duplicated helper's name and the central one; count call sites.
- **False positives:** two idioms both common across the repo; a local helper that genuinely
  differs in behavior from the central one.

## 2. UI / visual
- **Check:** reuse of UI primitives (Button, Dialog, Spinner, SearchBar, Tooltip) vs hand-rolled
  markup; spacing scale; loader component vs raw `animate-spin` icon; empty-state pattern; scrollbar
  utility vs inline scrollbar-hiding CSS; responsive breakpoints.
- **Measure:** count primitive usages vs raw equivalents (`grep -rl`). Count the utility class vs the
  inline form it replaces.
- **False positives:** Tailwind `size-N` vs `h-N w-N` (often *both* dominant — measure!). Two spinner
  components both in wide use — only flag mixing *within one new feature*.

## 3. Design tokens
- **Check:** semantic color tokens (`text-primary`, `bg-muted`, `border-border`) vs hardcoded
  hex/rgb or raw palette (`text-gray-500`); radius/shadow tokens; dark-mode parity; z-index scale.
- **Measure:** `grep -rnE '#[0-9a-fA-F]{3,6}|rgb\('` in changed files; compare with token usage counts.
- **False positives:** one-off brand colors that are hardcoded everywhere by design; canvas/chart
  code that legitimately needs literal colors.

## 4. i18n / copy
- **Check:** every user-facing string via the i18n framework (no hardcoded literals in JSX/aria);
  **all locale files updated** for new keys; key naming & namespacing matches siblings; placeholders
  and `aria-label`s localized; reuse of an existing translated key instead of a near-duplicate.
- **Measure:** diff the key set across all locale files (`python3` to load each, compare key paths);
  grep for hardcoded `aria-label="..."` and string literals in changed `.tsx`.
- **False positives:** example URLs/IDs that are identical across locales by convention; dev-only or
  console strings; values intentionally untranslated.

## 5. State & data-flow
- **Check:** store conventions (slice shape, selector use, action naming); query-key factory &
  query-hook conventions; **no `useState`+`useEffect` to mirror server/store state** (read the store
  directly, update on event); fetch/error-handling parity with sibling services.
- **Measure:** compare the new slice/query against an existing one side-by-side; grep for
  `useEffect(` that only calls a setter mirroring a prop/store value.
- **False positives:** genuinely local UI state; an effect with real external synchronization.

## 6. Architecture / layering
- **Check:** module placed in the right layer (pure parser lib must not import app/store types;
  API/wire types live with API types, not in a util lib); dependency direction (no UI imported by
  libs); server vs client boundary (`'use client'`, no server-only imports in client code); types
  living next to their consumers.
- **Measure:** inspect import statements of new/moved modules; trace what depends on what.
- **False positives:** an intentional shared type in a `shared` package; a re-export barrel.

## 7. API / types / wire
- **Check:** request/response shapes match the server contract; field casing at the boundary
  (snake_case wire vs camelCase domain) handled consistently with sibling endpoints; structured
  error results vs thrown exceptions match the service's existing pattern; no breaking change hidden
  behind a back-compat shim.
- **Measure:** compare the new service method against neighbors in the same file; check the server
  schema if reachable.
- **False positives:** snake/camel mix that *must* match the wire; deliberate structured-result design.

## 8. Naming & file structure
- **Check:** file naming (kebab vs camel), component/hook/util naming conventions, directory
  placement, export naming, test file co-location.
- **Measure:** list sibling files in the same directory; compare casing/prefix conventions.
- **False positives:** a domain term that legitimately breaks the casing pattern.

## 9. Accessibility & semantics
- **Check:** `aria-label`/role parity with sibling interactive elements; keyboard handlers present
  where siblings have them; focus management in modals/menus; alt text; semantic elements vs `div`s.
- **Measure:** compare the new interactive component against the closest existing one.
- **False positives:** decorative elements that correctly have no a11y semantics.

---

## Reporting contract for each agent

Return JSON: `{ findings: [{ title, file, line, deviation, established, prevalence, severity, confidence }] }`
where `severity ∈ {correctness, behavior, i18n, a11y, naming, cosmetic}` and `prevalence` states the
counts you measured (e.g. `"established 349×, deviation 2× (the diff)"`). No prevalence number → not a finding.
