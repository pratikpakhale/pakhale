# Architecture

How `pakhale setup agents` works inside. [README.md](README.md) is the user-facing version.

## The model

**Provisioned** — the repo stores a *reference*; setup runs the real installer, so upstream
updates arrive on their own. **Authored** — the repo owns the bytes, because there is no
upstream: `skills/`, `assets/`, and the typed `claudeCode` block in `config.ts`.

## Extensions and delivery

`config.extensions` is one entry per capability I want my agents to have — not per upstream
packaging format. "Plugin" is how Claude Code happens to ship something; opencode cannot read
`.claude-plugin/` at all. (Deliberately not called `tools`: in agent-land a tool is a function
the model calls, and `via: 'mcp'` supplies exactly those.) Each extension declares how it
reaches each agent:

```ts
{
  name: 'plannotator',
  deliver: {
    'claude-code': { via: 'claude-plugin', marketplace: 'plannotator', plugin: 'plannotator' },
    opencode: { via: 'opencode-plugin', package: '@plannotator/opencode@latest' },
  },
}
```

| `via` | Reaches | Mechanism |
| --- | --- | --- |
| `skills` | any agent that reads `SKILL.md` | `npx skills add <repo> -g -y -a <agent>` |
| `mcp` | any agent | agent-neutral declaration, translated per agent |
| `claude-plugin` | Claude Code only | `claude plugin marketplace add` + `install` |
| `opencode-plugin` | opencode only | npm module in the `plugin` array of its config |

- **`all` or per-agent, never silence.** `deliver: { all: … }` covers every agent in
  `config.agents`; a per-agent key overrides it. An agent that resolves to neither is a hard
  error before any emitter runs.
- **`unsupported` vs `skip`.** Upstream ships nothing, versus I chose not to. A `skills`
  delivery is portable by construction, so `skip` there is a preference, never a limitation.
- **Prefer a plugin where the agent has one** — plugins update themselves; installed skills
  only update when setup re-runs.
- **MCP is declared once, translated per agent** — `{ transport: 'stdio', command }` becomes
  `{ type: 'stdio', command, args }` for Claude Code, `{ type: 'local', command, enabled }`
  for opencode.

`marketplaces` is declared once at the top of `config.ts` and referenced by name, so a
repo/builtin flag lives in one place. Every run opens with the coverage matrix:

```
▸ Extensions
  context7              claude-code → claude-plugin   opencode → mcp
  mattpocock-skills     claude-code → claude-plugin   opencode → skills
  plannotator           claude-code → claude-plugin   opencode → opencode-plugin
  gh-stack              claude-code → skills          opencode → skills
```

The `claudeCode` block is a needed-only typed vocabulary — a typo'd field is a `tsc` error.
The emitter maps typed fields to raw `settings.json` keys (`effort` → `effortLevel`, `voice` →
`voiceEnabled`, …). `hooks` and `commandsDir` are emitted only when present.

## Plan / diff / commit

1. **Plan** — `emitter.buildPlan(ctx)` returns inert data: `Artifact[]` grouped into sections.
   An artifact is `file`, `symlink`, `jsonMerge` (unmanaged keys preserved, managed keys from
   config, derived keys computed), or `install` (a command plus a **probe**).
2. **Diff** — `diff(plan, state)` reads the machine and returns `Change[]`: `unchanged`,
   `blocked`, `pending` with the `Action` that would fix it, or `conflict`. It imports
   nothing that writes, so dry-run purity is structural rather than a flag every function
   must remember.
3. **Commit or render** — `runPlan` consults `dryRun` exactly once.

## Conflicts

`~/.agents/.setup-state.json` records a hash of everything setup last wrote — whole files
for `file` artifacts, per managed key for `jsonMerge` ones (other programs legitimately
rewrite the rest of those files, so whole-file hashes would cry wolf). The dpkg-conffile
rule follows: machine ≠ config is only a **conflict** when the machine also differs from
that record. Config edits converge silently; live machine edits — deleting a file or key
setup once wrote counts — and foreign files prompt.

A `conflict` carries two ready-made outcomes and the executor asks a `Resolver` — created
once per run in `applyAgents` so "…for all remaining" answers stick across agents — which
one to perform: **apply** (config wins; the displaced version is always backed up) or
**keep** (for `jsonMerge`, their values for the contested keys with everything else still
applied; elsewhere, do nothing). Interactive runs prompt keep / apply / show-diff; piped
runs keep, dpkg's safe default; `--force` applies. "Keep" is deliberately per-run — state
only ever records what setup itself wrote, so a kept conflict asks again next time instead
of being silently adopted. Adopting it for real is `sync-from-live`'s job. Deleting the
state file is safe: the next apply just asks about everything that differs.

Probes are what make installs converge — `claude plugin list`, `known_marketplaces.json`,
`.skill-lock.json` — instead of reporting *would install …* forever. One exception, by design:
a `skills` delivery with no `skills` list means "whatever the repo exposes today", which no
local file can confirm. It re-runs every time, which is also how it picks up new skills
upstream adds.

Authored skills install the way [skills.sh](https://skills.sh) does: one copy in the store,
linked into agents that need it.

```
repo/skills/deslop  ←  ~/.agents/skills/deslop  ←  ~/.claude/skills/deslop
                                   ↑
                        read directly by opencode
```

## Layout

```
config.ts              source of truth — marketplaces, extensions, claudeCode
src/
  cli.ts               entrypoint — dispatches to the command registry
  commands/
    index.ts             the command registry
    setup/
      index.ts           target dispatch — `pakhale setup <target>`
      agents/
        index.ts         argv, agent selection, then apply
        types.ts
        extensions.ts    delivery resolution, validation, coverage matrix
        installs.ts      installer commands + their probes, as artifacts
        plan.ts          Artifact / Plan data types
        diff.ts          desired minus actual → Change[]  (reads only, never writes)
        state.ts         the last-written record behind conflict detection
        resolve.ts       conflict resolvers — interactive prompt, keep, force
        executor.ts      renders the diff or commits it, resolving conflicts
        apply.ts         validate, shared store plan, then per agent
        store.ts         the agent-neutral ~/.agents/skills store plan
        emitters/        one per agent — id, configDir, buildPlan. No execution.
  util/                log, fs, exec, prompt
assets/                instructions + statusline (copied, not linked)
skills/                authored skills (cross-agent)
```

Published as `pakhale`: ships `dist/`, `skills/`, `assets/` — no source, no tests. Everything
resolves relative to the installed package root, so `npx pakhale setup agents` works anywhere.

## Safety

- **Idempotent.** Re-running reports `unchanged` and writes nothing — installers included.
  Comparison is key-order insensitive.
- **Merge, never clobber.** Keys not named in `config.ts` are preserved. `enabledPlugins`,
  `extraKnownMarketplaces`, `mcpServers`, and opencode's `plugin`/`mcp` are *derived* and
  repo-owned — but even those are never overwritten silently: anything setup did not write
  is a conflict (see above), resolved by a prompt, kept when piped, or taken by `--force`.
  Adopting a kept change for real is what `sync-from-live` is for.
- **A config that will not parse — or is not a JSON object** (`null`, an array) — **is left
  alone**, rather than silently flattened.
- **A missing installer blocks one artifact, not the run.**
- **Backups** land in `.setup-backups/<timestamp>/`, always *outside* skill scan paths.
- **Detection.** An agent with no config directory is skipped, not created.

## Testing

`test/plan.test.ts` asserts on `buildPlan`'s data — no sandbox, no writes.
`test/diff.test.ts` pins the three-way conflict matrix cell by cell — (machine, last-written
record, config) → unchanged / pending / conflict / blocked — on hand-built plans in a temp dir.
`test/prompt.test.ts` covers `shouldAsk` — the gate that decides *whether* to prompt. The picker
itself is `@clack/prompts` (bundled, like `picocolors`, so the package ships no runtime deps);
a raw-mode TUI can't be driven from a test, so the decision is what's pinned down. The same
split governs `test/resolve.test.ts`: the resolver takes its ask function as a parameter, so
everything around the picker — options offered, sticky "…all remaining", cancel-means-keep —
is pinned without a TTY.
`test/claude-code.test.ts` and `test/opencode.test.ts` run `applyAgents` against a **sandbox
HOME** and assert on the real filesystem, so what passes is what a fresh machine gets;
`test/conflicts.test.ts` does the same for every conflict flow — foreign files, live edits,
state loss and corruption, keep/force, and the `--force` CLI wiring — with injected resolvers
standing in for the prompt. Two
seams make that work: `EmitContext.home` is injected (`--home <dir>` exposes it on the CLI),
and `test/sandbox.ts` puts fake `claude`/`npx` shims on `PATH` that log their argv.

## Adding an agent

Export an `Emitter` — `id`, `configDir`, `buildPlan` — from
`src/commands/setup/agents/emitters/<agent>.ts`, register it in that dir's `index.ts`, and add
the id to `config.agents`. `applyAgents` owns detection and execution, so there is no per-agent
apply code. Adding the id makes `validateExtensions` demand a delivery from every extension, so the
run fails with the full list of holes instead of quietly under-installing. opencode is the
worked example.

Stubbed but not implemented: `codex` (`~/.codex/config.toml`, `AGENTS.md`, `hooks.json`).

## Adding a command or a setup target

The CLI is two levels deep, and both levels share one shape:
`{ name, describe, run(argv, packageRoot) }`.

- **A command** lives at `src/commands/<name>/index.ts` and is registered in
  `src/commands/index.ts`. `cli.ts` handles dispatch, `--help`, `--version`, and top-level
  error reporting.
- **A setup target** — another thing this machine can be set up from `config.ts`, alongside
  `agents` — lives at `src/commands/setup/<target>/index.ts` and is registered in
  `src/commands/setup/index.ts`. `setup` prints the target list and dispatches; the target
  owns everything below it.

Every level parses its own argv with `node:util` `parseArgs` and returns an exit code, so
nothing agents-specific leaks into the CLI shell or `package.json` scripts. Verbs that are not
`setup` belong at the top level against the domain noun — the planned drift command is
`pakhale agents sync`, not a second target under `setup`.
