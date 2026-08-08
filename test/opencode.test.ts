import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config'
import { applyAgents } from '../src/commands/setup/agents/apply'
import { skillDeliveries } from '../src/commands/setup/agents/extensions'
import type { EmitContext, SetupConfig } from '../src/commands/setup/agents/types'
import { makeSandbox, type Sandbox } from './sandbox'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function ctxFor(sbx: Sandbox, cfg: SetupConfig = config): EmitContext {
  return { home: sbx.home, repoRoot, config: cfg }
}

async function apply(sbx: Sandbox, dryRun = false, cfg: SetupConfig = config) {
  await applyAgents(ctxFor(sbx, cfg), ['opencode'], dryRun)
}

describe('opencode emitter', () => {
  test('installs the shared instructions to ~/.config/opencode/AGENTS.md', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)

    expect(await sbx.read('.config/opencode/AGENTS.md')).toBe(
      await Bun.file(join(repoRoot, config.instructionsFile)).text(),
    )
  })

  test('fills the shared ~/.agents store without touching ~/.claude', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)

    expect(await sbx.tree('.agents/skills')).toContain(
      `deslop -> ${join(repoRoot, 'skills/deslop')}`,
    )
    expect(await sbx.tree('.claude')).toEqual([])
  })

  test('installs only the skill deliveries resolved for opencode', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const npx = (await sbx.calls()).filter((c) => c.startsWith('npx'))

    const repos = skillDeliveries(config, 'opencode').map((d) => d.repo)
    expect(npx.length).toBe(repos.length)
    for (const repo of repos) expect(npx.some((c) => c.includes(repo))).toBe(true)
    expect(npx.every((c) => c.includes('-a opencode'))).toBe(true)
  })

  test('an extension skipped for opencode reaches it by no route at all', async () => {
    const sbx = await makeSandbox()
    const cfg: SetupConfig = {
      ...config,
      extensions: [
        {
          name: 'gh-stack',
          deliver: { 'claude-code': { via: 'skills', repo: 'github/gh-stack' }, opencode: 'skip' },
        },
      ],
    }
    await apply(sbx, false, cfg)

    expect((await sbx.calls()).some((c) => c.includes('github/gh-stack'))).toBe(false)
  })

  test('never runs `claude plugin` for opencode', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    expect((await sbx.calls()).some((c) => c.startsWith('claude plugin'))).toBe(false)
  })

  test('writes plugin and mcp keys into opencode.json, preserving foreign keys', async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.config/opencode/opencode.json'),
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'mine' }),
    )
    await apply(sbx)

    const j = await sbx.json<Record<string, any>>('.config/opencode/opencode.json')
    expect(j.$schema).toBe('https://opencode.ai/config.json')
    expect(j.model).toBe('mine')
    expect(j.plugin).toEqual(['@plannotator/opencode@latest'])
    expect(j.mcp.context7).toEqual({
      type: 'local',
      command: ['npx', '-y', '@upstash/context7-mcp'],
      enabled: true,
    })
  })

  test('writes into an existing opencode.jsonc rather than forking a second config', async () => {
    const sbx = await makeSandbox()
    await writeFile(
      join(sbx.home, '.config/opencode/opencode.jsonc'),
      JSON.stringify({ model: 'mine' }),
    )
    await apply(sbx)

    expect((await sbx.json<Record<string, any>>('.config/opencode/opencode.jsonc')).plugin).toEqual([
      '@plannotator/opencode@latest',
    ])
    expect(await sbx.tree('.config/opencode')).not.toContain('opencode.json')
  })

  test('refuses to merge an opencode config it cannot parse', async () => {
    const sbx = await makeSandbox()
    const original = '{ // comments are legal jsonc, not json\n  "model": "mine" }'
    await writeFile(join(sbx.home, '.config/opencode/opencode.jsonc'), original)

    await apply(sbx)

    expect(await sbx.read('.config/opencode/opencode.jsonc')).toBe(original)
  })

  test('is idempotent — a second run leaves everything byte-identical', async () => {
    const sbx = await makeSandbox()
    await apply(sbx)
    const first = await sbx.tree('.config/opencode')

    await apply(sbx)
    expect(await sbx.tree('.config/opencode')).toEqual(first)
  })

  test('dry run writes nothing', async () => {
    const sbx = await makeSandbox()
    await apply(sbx, true)
    expect(await sbx.tree('.config/opencode')).toEqual([])
  })

  test('skips a machine with no opencode install', async () => {
    const sbx = await makeSandbox({ withOpencodeDir: false })
    await apply(sbx)

    expect(await sbx.tree('.config')).toEqual([])
    expect((await sbx.calls()).some((c) => c.startsWith('npx'))).toBe(false)
  })

  test('applies both agents in one run through the shared store', async () => {
    const sbx = await makeSandbox()
    await applyAgents(ctxFor(sbx), ['claude-code', 'opencode'], false)

    expect(await sbx.tree('.claude/skills')).toContain('deslop -> ../../.agents/skills/deslop')
    expect(await sbx.read('.config/opencode/AGENTS.md')).toBe(await sbx.read('.claude/CLAUDE.md'))
  })
})
