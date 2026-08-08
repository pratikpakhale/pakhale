# pakhale

My personal CLI. It keeps my coding agents — [Claude Code](https://claude.com/claude-code) and
[opencode](https://opencode.ai) — set up the same way on every machine, from one file.

```bash
npx pakhale setup agents          # set up this machine
npx pakhale setup agents plan     # dry run — show every change, write nothing
```

Running `plan` first is always safe: it reads the machine and prints exactly what would change.

## What it sets up

[`config.ts`](config.ts) is the whole source of truth. It lists the agents I use and the
capabilities I want them to have — plugins, skills, MCP servers — plus my shared instructions
and settings. Applying it installs whatever is missing and leaves everything else alone.

Agents package things differently, so each capability says how it reaches each agent:

```ts
{
  name: 'plannotator',
  deliver: {
    'claude-code': { via: 'claude-plugin', marketplace: 'plannotator', plugin: 'plannotator' },
    opencode: { via: 'opencode-plugin', package: '@plannotator/opencode@latest' },
  },
}
```

| `via` | Reaches |
| --- | --- |
| `skills` | any agent that reads `SKILL.md` |
| `mcp` | any agent |
| `claude-plugin` | Claude Code |
| `opencode-plugin` | opencode |

Leaving an agent undeclared is an error rather than a silent skip, so adding a new agent tells
me about every gap at once.

## Options

- `plan` or `-n, --dry-run` — show every change, write nothing
- `-a, --agent <id>` — set up one agent (repeatable)
- `--all` — every configured agent, no prompt
- `--force` — resolve every conflict in the config's favour, no prompts
- `--home <dir>` — apply against a different home directory
- `-h, --help` — full usage

With a terminal and no `--agent`, it asks which agents to set up — space to toggle, `a` for all.
Piped or scripted, it applies to every configured agent without asking.

## Safe by default

- **Re-running changes nothing.** Every artifact is checked before it is written, installers
  included.
- **Nothing of yours is overwritten silently.** Setup remembers what it last wrote; anything
  else it finds — an existing `CLAUDE.md`, a setting changed by hand — is a conflict, and it
  asks: keep yours, use the config's (backed up first), or see the diff, with one answer for
  all remaining if you prefer. Piped runs keep yours; `--force` takes the config's.
- **Settings you added yourself survive.** Keys `config.ts` does not name are preserved.
- **A config file it cannot parse is left alone** rather than flattened.
- **Agents you do not have installed are skipped,** never created.
- **Anything it displaces is backed up** to `.setup-backups/<timestamp>/`.

## Development

```bash
bun install
bun src/cli.ts setup agents plan   # run from source
bun run test                       # ~5s, no network, never touches your real ~
bun run typecheck
bun run build                      # dist/cli.js (Node >=20)
```

[ARCHITECTURE.md](ARCHITECTURE.md) covers how it works inside — the config vocabulary, the
plan/diff/commit split, and how to add another agent.
