# pakhale

My personal CLI, published to npm as `pakhale`. `setup agents` is the declarative source of
truth for my coding-agent workflow (Claude Code and opencode; codex later). `config.ts`
declares, `bun src/cli.ts setup agents` applies, `bun src/cli.ts setup agents plan` dry-runs.
See `ARCHITECTURE.md` for the full architecture, `README.md` for the public face.

`setup` is a namespace and `agents` is one target under it, with more commands to come, so
nothing agents-specific belongs in `package.json` scripts — invoke the CLI directly.

## Invariants

- **Provisioned vs authored** is the load-bearing distinction. Provisioned things (an
  upstream exists) are referenced and installed via their real installer; authored
  things (no upstream) live in this repo and are emitted. Never vendor provisioned
  content; never provision authored content.
- **An extension declares a delivery per agent, or says why not.** `config.extensions` is
  one entry per capability I want my agents to have; `deliver` maps each agent in
  `config.agents` to a `via` (`skills`, `mcp`, `claude-plugin`, `opencode-plugin`) or an
  explicit `unsupported` (upstream ships nothing) / `skip` (I chose not to). Silence is a
  hard error, never a quiet no-op. Prefer a plugin wherever the agent has one — plugins
  update themselves; installed skills only update when setup re-runs. Never call this block
  "tools": a tool is a function the model calls, and `via: 'mcp'` supplies exactly those.
- **Converged means no-op**: after `bun src/cli.ts setup agents`, an immediate
  `bun src/cli.ts setup agents plan` must report everything unchanged. Any change that breaks
  this is a bug. Anything an external
  installer owns is an `install` artifact carrying a probe, for exactly this reason —
  a step that cannot report `unchanged` does not belong in a plan. The one sanctioned
  exception is a `skills` delivery with no `skills` list: completeness against a moving
  upstream is not locally knowable, so it re-runs by design. Never widen that exception by
  guessing from the lockfile — the lockfile records what was installed, not what exists.
- **Diff never writes.** `diff.ts` imports nothing that mutates the machine, and `dryRun`
  is consulted in exactly one place (`runPlan`). Keep it that way: a `dryRun` parameter
  reappearing anywhere downstream is the bug this structure exists to prevent.
- The machine is never the source of truth. Fix drift by changing this repo, then
  re-applying — see the `sync-from-live` skill (`.claude/skills/sync-from-live/`) for
  pulling live machine changes back here.
- Verification is sandboxed: `bun run test` must stay green and must never touch the
  real `~`. Backups are archived outside any skill scan path.

## Maintenance rules

- **Architecture changes must update the sync skill.** If you change the config
  vocabulary, the set of files the emitter owns, the symlink topology, or the
  directory layout, update `.claude/skills/sync-from-live/SKILL.md` (and
  `ARCHITECTURE.md`) in the same change. That skill diffs live machines against this
  repo — a stale skill silently mis-syncs. `README.md` stays minimal and public-facing;
  internal detail belongs in `ARCHITECTURE.md`.
- `skills/` holds authored skills installed to every machine; `.claude/skills/` holds
  repo-local tooling for working on this repo. Don't mix them up.
- No commits unless explicitly asked. Conventional commit messages when asked.
