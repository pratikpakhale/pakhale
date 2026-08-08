import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config'
import { applyAgents } from '../src/commands/setup/agents/apply'
import { claudePluginDeliveries, skillDeliveries } from '../src/commands/setup/agents/extensions'
import { forceResolver } from '../src/commands/setup/agents/resolve'
import type { EmitContext, SetupConfig } from '../src/commands/setup/agents/types'
import { makeSandbox, type Sandbox } from './sandbox'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function ctxFor(sbx: Sandbox, cfg: SetupConfig = config): EmitContext {
  return { home: sbx.home, repoRoot, config: cfg }
}

async function apply(sbx: Sandbox, dryRun = false, cfg: SetupConfig = config) {
  await applyAgents(ctxFor(sbx, cfg), ['claude-code'], dryRun)
}

describe('claude-code emitter', () => {
  test('provisions plugins via the CLI, skipping the built-in marketplace', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const calls = await sbx.calls()

    expect(calls).toContain('claude plugin marketplace add backnotprop/plannotator')
    expect(calls).toContain('claude plugin marketplace add pbakaus/impeccable')
    expect(calls.some((c) => c.includes('anthropics/claude-plugins-official'))).toBe(false)

    for (const d of claudePluginDeliveries(config)) {
      expect(calls).toContain(`claude plugin install ${d.plugin}@${d.marketplace}`)
    }
  })

  test('adds each marketplace once, however many plugins reference it', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const adds = (await sbx.calls()).filter((c) => c.startsWith('claude plugin marketplace add'))
    expect(adds.length).toBe(new Set(adds).size)
  })

  test('re-running skips a plugin the CLI already reports as installed', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const first = (await sbx.calls()).filter((c) => c.startsWith('claude plugin install'))
    expect(first.length).toBeGreaterThan(0)

    await apply(sbx)
    const second = (await sbx.calls()).filter((c) => c.startsWith('claude plugin install'))
    expect(second).toEqual(first)
  })

  test('installs only the skill deliveries resolved for claude-code', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const npx = (await sbx.calls()).filter((c) => c.startsWith('npx'))

    const repos = skillDeliveries(config, 'claude-code').map((d) => d.repo)
    expect(npx.length).toBe(repos.length)
    for (const repo of repos) expect(npx.some((c) => c.includes(repo))).toBe(true)
    expect(npx.every((c) => c.includes('-a claude-code'))).toBe(true)
  })

  test('links authored skills through the shared ~/.agents store', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)

    const store = await sbx.tree('.agents/skills')
    expect(store).toContain(`deslop -> ${join(repoRoot, 'skills/deslop')}`)

    const agent = await sbx.tree('.claude/skills')
    expect(agent).toContain('deslop -> ../../.agents/skills/deslop')
  })

  test('writes settings, preserving unmanaged keys and deriving plugin keys', async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.claude/settings.json'),
      JSON.stringify({ myOwnKey: 'keep me', model: 'stale' }),
    )
    await apply(sbx)

    const s = await sbx.json<Record<string, any>>('.claude/settings.json')
    expect(s.myOwnKey).toBe('keep me')
    expect(s.model).toBe('stale')
    expect(s.statusLine.command).toBe(`bash ${join(sbx.home, '.claude/statusline-command.sh')}`)
    expect(Object.keys(s.enabledPlugins).sort()).toEqual(
      claudePluginDeliveries(config)
        .map((d) => `${d.plugin}@${d.marketplace}`)
        .sort(),
    )
    expect(s.extraKnownMarketplaces['claude-plugins-official']).toBeUndefined()
    expect(s.extraKnownMarketplaces['plannotator'].source.repo).toBe('backnotprop/plannotator')
  })

  test('installs instructions and an executable statusline', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)

    expect(await sbx.read('.claude/CLAUDE.md')).toBe(
      await Bun.file(join(repoRoot, config.instructionsFile)).text(),
    )
    const st = await Bun.file(join(sbx.home, '.claude/statusline-command.sh')).stat()
    expect(st.mode & 0o111).toBeGreaterThan(0)
  })

  test('archives displaced directories outside the skill scan path', async () => {
    const sbx = await makeSandbox()
    const victim = join(sbx.home, '.claude/skills/deslop')
    await mkdir(victim, { recursive: true })
    await writeFile(join(victim, 'SKILL.md'), 'original content')

    // displacing a real directory is a conflict — force resolves it in config's favour
    await applyAgents(ctxFor(sbx), ['claude-code'], false, forceResolver)

    const skills = await sbx.tree('.claude/skills')
    expect(skills.some((p) => p.includes('.bak'))).toBe(false)
    expect(skills).toContain('deslop -> ../../.agents/skills/deslop')

    const archived = await sbx.tree('.claude/.setup-backups')
    expect(archived.some((p) => p.endsWith('deslop/SKILL.md'))).toBe(true)
  })

  test('is idempotent — a second run leaves the tree byte-identical', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const first = await sbx.tree('.claude/skills')
    const settings = await sbx.read('.claude/settings.json')

    await apply(sbx)

    expect(await sbx.tree('.claude/skills')).toEqual(first)
    expect(await sbx.read('.claude/settings.json')).toBe(settings)
  })

  test('dry run writes nothing', async () => {
    const sbx = await makeSandbox()
    await apply(sbx, true)

    expect(await sbx.tree('.claude')).toEqual([])
    expect(await sbx.tree('.agents')).toEqual([])
    expect((await sbx.calls()).filter((c) => c.includes('install'))).toEqual([])
  })

  test('skips a machine with no Claude Code install', async () => {
    const sbx = await makeSandbox({ withClaudeDir: false })
    await apply(sbx)

    expect(await sbx.tree('.claude')).toEqual([])
    expect((await sbx.calls()).some((c) => c.startsWith('claude plugin install'))).toBe(false)
  })

  test('merges mcpServers into ~/.claude.json, preserving foreign keys', async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.claude.json'),
      JSON.stringify({ numStartups: 42, oauthAccount: { email: 'x' } }),
    )

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
    await apply(sbx, false, cfg)

    const j = await sbx.json<Record<string, any>>('.claude.json')
    expect(j.numStartups).toBe(42)
    expect(j.oauthAccount).toEqual({ email: 'x' })
    expect(j.mcpServers).toEqual({ context7: { type: 'http', url: 'https://mcp.context7.com' } })
  })

  test('refuses to merge a settings file it cannot parse', async () => {
    const sbx = await makeSandbox()
    const dest = join(sbx.home, '.claude/settings.json')
    await writeFile(dest, '{ // a comment JSON.parse chokes on\n  "myOwnKey": "keep me" }')

    await apply(sbx)

    expect(await sbx.read('.claude/settings.json')).toContain('a comment JSON.parse chokes on')
  })
})
