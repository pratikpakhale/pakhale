import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config'
import { agents } from '../src/commands/setup/agents'
import { applyAgents } from '../src/commands/setup/agents/apply'
import type { Conflict } from '../src/commands/setup/agents/diff'
import { forceResolver, keepResolver, type Resolver } from '../src/commands/setup/agents/resolve'
import { stateFileFor } from '../src/commands/setup/agents/state'
import type { EmitContext, SetupConfig } from '../src/commands/setup/agents/types'
import { makeSandbox, type Sandbox } from './sandbox'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function ctxFor(sbx: Sandbox, cfg: SetupConfig = config): EmitContext {
  return { home: sbx.home, repoRoot, config: cfg }
}

function withEffort(effort: 'medium' | 'high'): SetupConfig {
  return { ...config, claudeCode: { ...config.claudeCode, effort } }
}

/** Records what it was asked so tests can assert prompts fire only on real conflicts. */
function spy(answer: 'apply' | 'keep', seen: Conflict[]): Resolver {
  return async (c) => {
    seen.push(c)
    return answer
  }
}

describe('conflict resolution', () => {
  test('a foreign CLAUDE.md is kept, not clobbered, when no one is there to ask', async () => {
    const sbx = await makeSandbox()
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'their own instructions')

    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)

    expect(await sbx.read('.claude/CLAUDE.md')).toBe('their own instructions')
  })

  test('--force takes the config version and backs the foreign file up first', async () => {
    const sbx = await makeSandbox()
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'their own instructions')

    await applyAgents(ctxFor(sbx), ['claude-code'], false, forceResolver)

    expect(await sbx.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, config.instructionsFile)).text(),
    )
    const archived = await sbx.tree('.claude/.setup-backups')
    expect(archived.some((p) => p.endsWith('CLAUDE.md'))).toBe(true)
  })

  test('a fresh machine raises no conflicts at all', async () => {
    const sbx = await makeSandbox()
    const seen: Conflict[] = []

    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))

    expect(seen).toEqual([])
  })

  test('a config change after setup last wrote converges silently — no prompt', async () => {
    const sbx = await makeSandbox()
    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx, withEffort('medium')), ['claude-code'], false, keepResolver)

    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, spy('keep', seen))

    expect(seen).toEqual([])
    expect((await sbx.json<Record<string, any>>('.claude/settings.json')).effortLevel).toBe('high')
  })

  test('an instructions edit in the repo overwrites without asking once state knows the file', async () => {
    const sbx = await makeSandbox()
    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)

    const edited: SetupConfig = { ...config, instructionsFile: 'README.md' }
    await applyAgents(ctxFor(sbx, edited), ['claude-code'], false, spy('keep', seen))

    expect(seen).toEqual([])
    expect(await sbx.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, 'README.md')).text(),
    )
  })

  test('a live edit to a written file conflicts; keep preserves it, force adopts config', async () => {
    const sbx = await makeSandbox()
    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'tweaked live on this machine')

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))
    expect(seen.map((c) => c.label)).toEqual([join(sbx.home, '.claude/CLAUDE.md')])
    expect(seen[0]!.diffText).toContain('tweaked live on this machine')
    expect(await sbx.read('.claude/CLAUDE.md')).toBe('tweaked live on this machine')

    await applyAgents(ctxFor(sbx), ['claude-code'], false, forceResolver)
    expect(await sbx.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, config.instructionsFile)).text(),
    )
  })

  test('a managed settings key set by hand conflicts; keep holds it and applies the rest', async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.claude/settings.json'),
      JSON.stringify({ effortLevel: 'low', myOwnKey: 'keep me' }),
    )

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, spy('keep', seen))

    expect(seen.map((c) => c.summary)).toEqual(['set outside setup: effortLevel'])
    const s = await sbx.json<Record<string, any>>('.claude/settings.json')
    expect(s.effortLevel).toBe('low')
    expect(s.myOwnKey).toBe('keep me')
    expect(s.statusLine).toBeDefined()
    expect(s.enabledPlugins).toBeDefined()
  })

  test('a kept key is asked about again next run, never silently adopted', async () => {
    const sbx = await makeSandbox()
    await writeFile(join(sbx.home, '.claude/settings.json'), JSON.stringify({ effortLevel: 'low' }))
    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, keepResolver)

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, spy('apply', seen))

    expect(seen.map((c) => c.summary)).toEqual(['set outside setup: effortLevel'])
    expect((await sbx.json<Record<string, any>>('.claude/settings.json')).effortLevel).toBe('high')
  })

  test('a displaced skill directory is kept in place without an interactive yes', async () => {
    const sbx = await makeSandbox()
    const victim = join(sbx.home, '.claude/skills/deslop')
    await mkdir(victim, { recursive: true })
    await writeFile(join(victim, 'SKILL.md'), 'their skill')

    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)

    expect(await sbx.read('.claude/skills/deslop/SKILL.md')).toBe('their skill')
  })

  test('dry run reports conflicts but writes no state file', async () => {
    const sbx = await makeSandbox()
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'their own instructions')

    await applyAgents(ctxFor(sbx), ['claude-code'], true, keepResolver)

    expect(await sbx.tree('.agents')).toEqual([])
    expect(await sbx.read('.claude/CLAUDE.md')).toBe('their own instructions')
  })

  test('dry run never invokes the resolver — conflicts are reported, not asked', async () => {
    const sbx = await makeSandbox()
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'their own instructions')
    const never: Resolver = async () => {
      throw new Error('resolver must not run during a dry run')
    }

    await applyAgents(ctxFor(sbx), ['claude-code'], true, never)
  })

  test('a foreign file that already matches the config is agreement, and is adopted as ours', async () => {
    const sbx = await makeSandbox()
    const desired = await Bun.file(join(repoRoot, config.instructionsFile)).text()
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), desired)

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))
    expect(seen).toEqual([])

    // ...so a later live edit is drift against it, exactly as if setup had written it
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'edited live')
    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))
    expect(seen.map((c) => c.label)).toEqual([join(sbx.home, '.claude/CLAUDE.md')])
  })

  test('a deleted state file re-seeds from a converged run instead of crying wolf', async () => {
    const sbx = await makeSandbox()
    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)
    await rm(stateFileFor(sbx.home))

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))
    expect(seen).toEqual([])
    expect(await sbx.tree('.agents')).toContain('.setup-state.json')

    const edited: SetupConfig = { ...config, instructionsFile: 'README.md' }
    await applyAgents(ctxFor(sbx, edited), ['claude-code'], false, spy('keep', seen))
    expect(seen).toEqual([])
    expect(await sbx.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, 'README.md')).text(),
    )
  })

  test('a corrupted state file degrades to asking again, never to crashing or clobbering', async () => {
    const sbx = await makeSandbox()
    await applyAgents(ctxFor(sbx), ['claude-code'], false, keepResolver)
    await writeFile(stateFileFor(sbx.home), 'not json at all')
    await writeFile(join(sbx.home, '.claude/CLAUDE.md'), 'edited live')

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['claude-code'], false, spy('keep', seen))

    expect(seen.map((c) => c.label)).toEqual([join(sbx.home, '.claude/CLAUDE.md')])
    expect(await sbx.read('.claude/CLAUDE.md')).toBe('edited live')
  })

  test('keeping writes nothing when the contested key is the only difference', async () => {
    const sbx = await makeSandbox()
    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, keepResolver)
    const settings = JSON.parse(await sbx.read('.claude/settings.json'))
    settings.effortLevel = 'low'
    await writeFile(join(sbx.home, '.claude/settings.json'), JSON.stringify(settings))
    const before = await sbx.read('.claude/settings.json')

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx, withEffort('high')), ['claude-code'], false, spy('keep', seen))

    expect(seen.map((c) => c.summary)).toEqual(['set outside setup: effortLevel'])
    expect(await sbx.read('.claude/settings.json')).toBe(before)
  })

  test('a live-added MCP server conflicts; keep holds the whole map, force restores config', async () => {
    const sbx = await makeSandbox()
    const cfg: SetupConfig = {
      ...config,
      extensions: [
        {
          name: 'context7',
          deliver: {
            all: { via: 'mcp', server: { transport: 'http', url: 'https://mcp.context7.com' } },
          },
        },
      ],
    }
    await applyAgents(ctxFor(sbx, cfg), ['claude-code'], false, keepResolver)

    const live = JSON.parse(await sbx.read('.claude.json'))
    live.mcpServers.mine = { type: 'http', url: 'https://example.com' }
    await writeFile(join(sbx.home, '.claude.json'), JSON.stringify(live))

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx, cfg), ['claude-code'], false, spy('keep', seen))
    expect(seen.map((c) => c.summary)).toEqual(['set outside setup: mcpServers'])
    let j = await sbx.json<Record<string, any>>('.claude.json')
    expect(j.mcpServers.mine).toBeDefined()
    expect(j.mcpServers.context7).toBeDefined()

    await applyAgents(ctxFor(sbx, cfg), ['claude-code'], false, forceResolver)
    j = await sbx.json<Record<string, any>>('.claude.json')
    expect(j.mcpServers.mine).toBeUndefined()
    expect(j.mcpServers.context7).toBeDefined()
    const archived = await sbx.tree('.claude/.setup-backups')
    expect(archived.some((p) => p.endsWith('.claude.json'))).toBe(true)
  })

  test("opencode's owned keys conflict the same way", async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.config/opencode/opencode.json'),
      JSON.stringify({ plugin: ['their-plugin'], model: 'mine' }),
    )

    const seen: Conflict[] = []
    await applyAgents(ctxFor(sbx), ['opencode'], false, spy('keep', seen))
    expect(seen.map((c) => c.summary)).toEqual(['set outside setup: plugin'])
    let j = await sbx.json<Record<string, any>>('.config/opencode/opencode.json')
    expect(j.plugin).toEqual(['their-plugin'])
    expect(j.model).toBe('mine')
    expect(j.mcp).toBeDefined()

    await applyAgents(ctxFor(sbx), ['opencode'], false, forceResolver)
    j = await sbx.json<Record<string, any>>('.config/opencode/opencode.json')
    expect(j.plugin).toEqual(['@plannotator/opencode@latest'])
    expect(j.model).toBe('mine')
  })

  test('`setup agents --force` wires through; piped runs without it keep', async () => {
    const kept = await makeSandbox()
    await writeFile(join(kept.home, '.claude/CLAUDE.md'), 'their own instructions')
    expect(await agents.run(['--all', '--home', kept.home], repoRoot)).toBe(0)
    expect(await kept.read('.claude/CLAUDE.md')).toBe('their own instructions')

    const forced = await makeSandbox()
    await writeFile(join(forced.home, '.claude/CLAUDE.md'), 'their own instructions')
    expect(await agents.run(['--all', '--force', '--home', forced.home], repoRoot)).toBe(0)
    expect(await forced.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, config.instructionsFile)).text(),
    )
  })
})
