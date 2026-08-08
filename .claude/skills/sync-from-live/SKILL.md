---
name: sync-from-live
description: Detect drift between the live coding-agent state on this machine (~/.claude, ~/.agents, ~/.claude.json, ~/.config/opencode) and this repo's declarations, then adopt wanted changes back into config.ts, skills/, and assets/. Use when the user says sync, adopt, drift, "I changed my Claude/opencode settings/plugins/skills live", or wants machine state pulled back into the setup repo.
---

# Sync live agent state back into this repo

Direction matters: this skill pulls **machine → repo**. The reverse (repo → machine) is
`bun src/cli.ts setup agents`. The definition of "synced" is the CLI's own convergence check:

> **Synced ⇔ `bun src/cli.ts setup agents plan` reports every item unchanged / already
> linked / skipped.**

Drive toward that invariant. Never edit files under `~` to make the plan pass — fix the
repo side, then let `bun src/cli.ts setup agents` reconcile the machine.

## Step 0 — read the current architecture first

This repo's shape evolves. Before diffing anything, read `ARCHITECTURE.md`, `config.ts`, and
`src/commands/setup/agents/types.ts` to learn the current config vocabulary and which files
the emitters own. Do not trust remembered shapes — including any shapes implied by this
skill.

## Workflow

1. **Inventory live state** (read-only):
   - `claude plugin list`, `~/.claude/plugins/known_marketplaces.json`
   - `~/.agents/.skill-lock.json` — skill names are the keys **under the `skills` key**,
     never the `skillPath` leaf (leaves have lied before). Each entry's `source` is the
     `owner/repo` it came from. These are the same two facts the `install` probes read,
     so a name mismatch here shows up as a plan that never converges
   - `ls -la ~/.claude/skills` (symlink vs real dir per entry), `~/.agents/skills`
   - `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.claude/statusline-command.sh`
   - `~/.claude.json` `mcpServers` key only, `~/.claude/commands/` — if the current
     config vocabulary covers them
   - `~/.config/opencode/AGENTS.md` (managed copy of the shared instructions; opencode
     reads skills straight from `~/.agents/skills`, no per-agent links to inventory)
   - `~/.config/opencode/opencode.jsonc` (or `.json`) — the `plugin` and `mcp` keys only
2. **Diff against repo declarations** and build a drift table: item, live value, repo
   value, proposed action.
3. **Confirm with the user** before adopting anything. Needed-only discipline: an
   unknown settings key is a question ("adopt into the typed vocabulary, or leave
   unmanaged?"), not an automatic adoption.
4. **Apply adoptions to the repo** (`config.ts`, `skills/`, `assets/`), never to `~`.
5. **Verify**: `bun run typecheck`, `bun run test`, then `bun src/cli.ts setup agents plan` —
   repeat until the plan is a no-op. Show the user the remaining diff if convergence needs
   `bun src/cli.ts setup agents` (i.e. the machine is behind the repo, not ahead).

## Adoption rules (encode the bucket, not the instance)

Every drifted item lands by its bucket — **provisioned** (has an upstream; repo stores a
reference) or **authored** (no upstream; repo owns the bytes):

Every adoption lands as an **extension** in `config.extensions` with a `deliver` entry per
agent — see the *Extensions and delivery* section of `ARCHITECTURE.md`. Adopting one agent's
route is only half the job: decide the other agents' routes in the same edit, since
`validateExtensions` rejects an extension that leaves any configured agent undeclared. Prefer a
plugin wherever the agent has one, and remember that a `skills` delivery is portable — `skip`
for another agent is a preference, not a limitation, so say why.

| Drift found live | Action |
| --- | --- |
| Plugin installed but absent from config | Add an extension with a `claude-plugin` delivery; register its marketplace in `config.marketplaces` from `known_marketplaces.json` (`anthropics/claude-plugins-official` is `builtin`). Then check whether the same upstream reaches the other agents — `npx skills add <repo> -l` lists what is extractable as skills, and the vendor's docs say whether it ships an opencode plugin or MCP server |
| skills.sh skill in lockfile, linked into the agent, absent from config | Add an extension with a `skills` delivery for that agent (repo + lockfile-key name) |
| skills.sh skill in lockfile but **not** linked into this agent | Leave it — likely provided to another agent or superseded by a plugin. Never adopt a skill a plugin already provides for the same agent; that double-loads it |
| opencode `plugin` entry or `mcp` server present live, absent from config | Adopt as an extension (`opencode-plugin` / `mcp`). Do **not** leave it live-only: both keys are repo-owned, so the next apply removes anything undeclared |
| Real directory in `~/.claude/skills` or `~/.agents/skills` (not a symlink into the repo) | Authored candidate: confirm origin, move into repo `skills/`, let setup relink |
| Edits made *through* an existing symlink | Already in the repo working tree — just surface them for git review |
| `CLAUDE.md` / `~/.config/opencode/AGENTS.md` / statusline edited live | These are copies, not symlinks — diff and copy back into `assets/` |
| Managed settings key changed live | Update the corresponding typed config field |
| Unknown settings key added live | Ask; adopt into the typed vocabulary only if wanted long-term |
| `mcpServers` / hooks / commands drift | Same managed-vs-ask split, per the current config vocabulary |

**Never sync**: runtime state — sessions, history, caches, `installed_plugins.json`,
plugin caches, `.setup-backups/`, or anything under `~/.claude.json` other than
`mcpServers`. Derived keys (`enabledPlugins`, `extraKnownMarketplaces`, `statusLine`,
`mcpServers`, and opencode's `plugin`/`mcp`) are never edited directly — change the
`config.extensions` declaration they derive from instead. `known_marketplaces.json` and
`.skill-lock.json` are read as *probes* and never written by setup: they are inputs to the
convergence check, not adoption targets.

Under `~/.config/opencode/`, the repo owns `AGENTS.md` plus exactly two keys of
`opencode.jsonc` — `plugin` and `mcp` (user decision, 2026-08-08, superseding the earlier
leave-it-alone rule). Every other key there (providers, models, permissions, keybinds) stays
unmanaged and must survive an apply untouched. The emitter writes whichever of
`opencode.jsonc` / `opencode.json` already exists, and refuses to write at all if the file
has real comments — if you see that error, the fix is to strip the comments or hand-edit,
never to delete the file.

## Maintenance

This skill mirrors the repo's architecture. When the architecture changes (config
vocabulary, emitter-owned files, directory layout), update this file in the same
change — `AGENTS.md` at the repo root states this rule.
