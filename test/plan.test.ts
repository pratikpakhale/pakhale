import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config'
import { buildPlan } from '../src/commands/setup/agents/emitters/claude-code'
import { buildPlan as buildOpencodePlan } from '../src/commands/setup/agents/emitters/opencode'
import {
  claudePluginDeliveries,
  deliveryFor,
  skillDeliveries,
  validateExtensions,
} from '../src/commands/setup/agents/extensions'
import type {
  InstallArtifact,
  JsonMergeArtifact,
  Plan,
  SymlinkArtifact,
} from '../src/commands/setup/agents/plan'
import { buildStorePlan } from '../src/commands/setup/agents/store'
import type { EmitContext, Extension, SetupConfig } from '../src/commands/setup/agents/types'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = '/fake/home'

function ctxFor(cfg: SetupConfig = config): EmitContext {
  return { home, repoRoot, config: cfg }
}

function withExtensions(...extensions: Extension[]): SetupConfig {
  return { ...config, extensions }
}

function artifacts(plan: Plan) {
  return plan.groups.flatMap((g) => g.artifacts)
}

function installs(plan: Plan): InstallArtifact[] {
  return artifacts(plan).filter((a): a is InstallArtifact => a.kind === 'install')
}

function merge(plan: Plan, suffix: string): JsonMergeArtifact {
  const a = artifacts(plan).find((a) => a.kind === 'jsonMerge' && a.dest.endsWith(suffix))
  return a as JsonMergeArtifact
}

const settingsMerge = (plan: Plan) => merge(plan, '.claude/settings.json')

describe('claude-code plan', () => {
  test('describes plugin installs as probed artifacts, one marketplace add each', async () => {
    const plan = await buildPlan(ctxFor())
    const plugins = installs(plan).filter((a) => a.command[0] === 'claude')

    const adds = plugins.filter((a) => a.command.includes('marketplace'))
    expect(adds.map((a) => a.label)).toEqual(['marketplace plannotator', 'marketplace impeccable'])
    expect(adds.every((a) => a.probe.kind === 'claude-marketplace')).toBe(true)

    const installed = plugins.filter((a) => !a.command.includes('marketplace'))
    expect(installed.map((a) => a.label)).toEqual(
      claudePluginDeliveries(config).map((d) => `${d.plugin}@${d.marketplace}`),
    )
    expect(installed.every((a) => a.requires === 'claude')).toBe(true)
  })

  test('probes skill installs against the lockfile and the agent skills dir', async () => {
    const plan = await buildPlan(ctxFor())
    const skills = installs(plan).filter((a) => a.command[0] === 'npx')

    expect(skills.map((a) => a.command)).toEqual(
      skillDeliveries(config, 'claude-code').map((d) => [
        ...['npx', '-y', 'skills', 'add', d.repo, '-g', '-y', '-a', 'claude-code'],
        ...(d.skills?.length ? ['-s', ...d.skills] : []),
      ]),
    )
    expect(skills[0]!.probe).toEqual({
      kind: 'skills',
      lockFile: join(home, '.agents/.skill-lock.json'),
      names: ['vercel-react-best-practices', 'vercel-composition-patterns'],
      linkDir: join(home, '.claude/skills'),
    })
  })

  test('a delivery with no skill list installs everything and pins no names', async () => {
    const cfg = withExtensions({
      name: 'everything',
      deliver: { all: { via: 'skills', repo: 'acme/skills' } },
    })
    const [install] = installs(await buildPlan(ctxFor(cfg)))

    expect(install!.label).toBe('acme/skills (all)')
    expect(install!.command).not.toContain('-s')
    expect(install!.probe).toMatchObject({ kind: 'skills', names: [] })
  })

  test('links the agent skills dir into the shared store, archiving outside the scan path', async () => {
    const plan = await buildPlan(ctxFor())
    const links = artifacts(plan).filter((a): a is SymlinkArtifact => a.kind === 'symlink')

    expect(links).toContainEqual({
      kind: 'symlink',
      target: '../../.agents/skills/deslop',
      linkPath: join(home, '.claude/skills/deslop'),
      archiveDisplaced: join(plan.archiveDir, 'agent-skills'),
    })
    expect(links.every((l) => l.linkPath.startsWith(join(home, '.claude/skills')))).toBe(true)
    expect(plan.archiveDir.startsWith(join(home, '.claude/.setup-backups/'))).toBe(true)
    for (const l of links) {
      expect(l.archiveDisplaced!.startsWith(join(home, '.claude/skills'))).toBe(false)
    }
  })

  test('maps typed claude-code fields to the exact raw settings keys', async () => {
    const cfg: SetupConfig = {
      ...config,
      claudeCode: {
        statuslineScript: config.claudeCode.statuslineScript,
        effort: 'high',
        autoCompactWindow: 250000,
        tui: 'fullscreen',
        cleanupPeriodDays: 7,
        voice: true,
        autoDream: false,
        agentPushNotifications: true,
        permissions: { defaultMode: 'auto', skipDangerousModePrompt: true, skipAutoPrompt: true },
      },
    }
    const { managed } = settingsMerge(await buildPlan(ctxFor(cfg)))
    const expected = {
      effortLevel: 'high',
      autoCompactWindow: 250000,
      tui: 'fullscreen',
      cleanupPeriodDays: 7,
      voiceEnabled: true,
      autoDreamEnabled: false,
      agentPushNotifEnabled: true,
      permissions: { defaultMode: 'auto' },
      skipDangerousModePermissionPrompt: true,
      skipAutoPermissionPrompt: true,
    }
    expect(managed).toEqual(expected)
    expect(Object.keys(managed)).toEqual(Object.keys(expected))
  })

  test('derives statusLine and plugin keys the config cannot set', async () => {
    const { derived } = settingsMerge(await buildPlan(ctxFor()))
    expect(derived.statusLine).toEqual({
      type: 'command',
      command: `bash ${join(home, '.claude/statusline-command.sh')}`,
    })
    expect(Object.keys(derived.enabledPlugins as object).sort()).toEqual(
      claudePluginDeliveries(config)
        .map((d) => `${d.plugin}@${d.marketplace}`)
        .sort(),
    )
    const markets = derived.extraKnownMarketplaces as Record<string, any>
    expect(markets['claude-plugins-official']).toBeUndefined()
    expect(markets['plannotator'].source.repo).toBe('backnotprop/plannotator')
  })

  test('includes hooks in managed settings only when configured', async () => {
    const base = settingsMerge(await buildPlan(ctxFor()))
    expect('hooks' in base.managed).toBe(false)

    const hooks = {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'echo hi' }] }],
    }
    const withHooks = settingsMerge(
      await buildPlan(ctxFor({ ...config, claudeCode: { ...config.claudeCode, hooks } })),
    )
    expect(withHooks.managed.hooks).toEqual(hooks)
  })

  test('adds a ~/.claude.json merge only when an extension delivers MCP to claude-code', async () => {
    const claudeJson = (plan: Plan) =>
      artifacts(plan).find((a) => a.kind === 'jsonMerge' && a.dest === join(home, '.claude.json'))

    expect(claudeJson(await buildPlan(ctxFor()))).toBeUndefined()

    const cfg = withExtensions({
      name: 'context7',
      deliver: {
        all: {
          via: 'mcp',
          server: { transport: 'stdio', command: ['npx', '-y', '@upstash/context7-mcp'] },
        },
      },
    })
    expect(claudeJson(await buildPlan(ctxFor(cfg)))).toEqual({
      kind: 'jsonMerge',
      dest: join(home, '.claude.json'),
      managed: {},
      derived: {
        mcpServers: {
          context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        },
      },
    })
  })

  test('translates an http MCP declaration into claude-code shape', async () => {
    const cfg = withExtensions({
      name: 'remote',
      deliver: {
        all: {
          via: 'mcp',
          server: { transport: 'http', url: 'https://example.com/mcp', headers: { A: 'b' } },
        },
      },
    })
    const { derived } = merge(await buildPlan(ctxFor(cfg)), '.claude.json')
    expect(derived.mcpServers).toEqual({
      remote: { type: 'http', url: 'https://example.com/mcp', headers: { A: 'b' } },
    })
  })

  test('adds command file artifacts only when a commands dir is configured', async () => {
    const base = await buildPlan(ctxFor())
    expect(base.groups.some((g) => g.section === 'Commands')).toBe(false)

    const dir = await mkdtemp(join(tmpdir(), 'setup-cmds-'))
    await writeFile(join(dir, 'ship.md'), '# ship')
    await writeFile(join(dir, 'notes.txt'), 'not a command')

    const plan = await buildPlan(
      ctxFor({ ...config, claudeCode: { ...config.claudeCode, commandsDir: dir } }),
    )
    const commands = plan.groups.find((g) => g.section === 'Commands')
    expect(commands?.artifacts).toEqual([
      { kind: 'file', src: join(dir, 'ship.md'), dest: join(home, '.claude/commands/ship.md') },
    ])
  })
})

describe('extension delivery resolution', () => {
  test('every declared extension resolves on every configured agent', () => {
    for (const extension of config.extensions) {
      for (const agent of config.agents) {
        expect(() => deliveryFor(extension, agent)).not.toThrow()
      }
    }
  })

  test('a per-agent delivery overrides `all`, and a NoDelivery marker resolves to none', () => {
    const extension: Extension = {
      name: 'x',
      deliver: {
        all: { via: 'skills', repo: 'acme/skills' },
        opencode: { via: 'opencode-plugin', package: '@acme/opencode' },
        codex: 'unsupported',
      },
    }
    expect(deliveryFor(extension, 'claude-code')).toEqual({ via: 'skills', repo: 'acme/skills' })
    expect(deliveryFor(extension, 'opencode')).toEqual({
      via: 'opencode-plugin',
      package: '@acme/opencode',
    })
    expect(deliveryFor(extension, 'codex')).toBeNull()
  })

  test('an undeclared agent is an error, never a silent no-op', () => {
    const extension: Extension = {
      name: 'x',
      deliver: { 'claude-code': { via: 'skills', repo: 'a/b' } },
    }
    expect(() => deliveryFor(extension, 'opencode')).toThrow(/no delivery for opencode/)
  })

  test('the live config validates', () => {
    expect(() => validateExtensions(config)).not.toThrow()
  })

  test('validation reports every hole at once, before any emitter runs', () => {
    const cfg = withExtensions(
      { name: 'a', deliver: { 'claude-code': { via: 'skills', repo: 'a/b' } } },
      { name: 'b', deliver: { all: { via: 'claude-plugin', marketplace: 'nope', plugin: 'b' } } },
      { name: 'c', deliver: { all: { via: 'skills', repo: 'c/d' }, codex: 'skip' } },
    )
    expect(() => validateExtensions(cfg)).toThrow(/a: no delivery for opencode/)
    expect(() => validateExtensions(cfg)).toThrow(/b: unknown marketplace "nope"/)
    expect(() => validateExtensions(cfg)).toThrow(/c: delivery for "codex", which is not in/)
  })
})

describe('shared store plan', () => {
  test('links authored skills into ~/.agents, archiving outside the scan path', async () => {
    const plan = await buildStorePlan(ctxFor())
    const links = artifacts(plan).filter((a): a is SymlinkArtifact => a.kind === 'symlink')

    expect(links).toContainEqual({
      kind: 'symlink',
      target: join(repoRoot, 'skills/deslop'),
      linkPath: join(home, '.agents/skills/deslop'),
      archiveDisplaced: join(plan.archiveDir, 'skills'),
    })
    expect(installs(plan)).toEqual([])
    expect(plan.archiveDir.startsWith(join(home, '.agents/.setup-backups/'))).toBe(true)
    for (const l of links) {
      expect(l.archiveDisplaced!.startsWith(join(home, '.agents/skills'))).toBe(false)
    }
  })
})

describe('opencode plan', () => {
  test('installs the shared instructions as the global AGENTS.md', async () => {
    const plan = await buildOpencodePlan(ctxFor())
    const instructions = plan.groups.find((g) => g.section === 'Instructions')
    expect(instructions?.artifacts).toEqual([
      {
        kind: 'file',
        src: join(repoRoot, config.instructionsFile),
        dest: join(home, '.config/opencode/AGENTS.md'),
      },
    ])
  })

  test('targets skill installs at opencode and probes the store directly', async () => {
    const plan = await buildOpencodePlan(ctxFor())
    const skills = installs(plan)

    expect(skills.map((a) => a.label)).toEqual(
      skillDeliveries(config, 'opencode').map((d) => `${d.repo} (${d.skills?.length ?? 'all'})`),
    )
    expect(skills.every((a) => a.command.includes('-a') && a.command.includes('opencode'))).toBe(
      true,
    )
    // The lockfile is agent-agnostic, so a name-only probe would be satisfied by whichever
    // agent installed first and opencode's install would be skipped forever. It has to probe
    // the store it actually reads.
    expect(
      skills.every(
        (a) => a.probe.kind === 'skills' && a.probe.linkDir === join(home, '.agents/skills'),
      ),
    ).toBe(true)
    expect(plan.archiveDir.startsWith(join(home, '.config/opencode/.setup-backups/'))).toBe(true)
  })

  test('derives the plugin list and mcp block into opencode.json', async () => {
    const cfg = withExtensions(
      {
        name: 'plannotator',
        deliver: {
          'claude-code': 'skip',
          opencode: { via: 'opencode-plugin', package: '@plannotator/opencode@latest' },
        },
      },
      {
        name: 'context7',
        deliver: {
          'claude-code': 'skip',
          opencode: {
            via: 'mcp',
            server: { transport: 'stdio', command: ['npx', '-y', '@upstash/context7-mcp'] },
          },
        },
      },
    )
    expect(merge(await buildOpencodePlan(ctxFor(cfg)), 'opencode.json')).toEqual({
      kind: 'jsonMerge',
      dest: join(home, '.config/opencode/opencode.json'),
      managed: {},
      derived: {
        plugin: ['@plannotator/opencode@latest'],
        mcp: {
          context7: {
            type: 'local',
            command: ['npx', '-y', '@upstash/context7-mcp'],
            enabled: true,
          },
        },
      },
    })
  })

  test('omits the config artifact entirely when no extension needs opencode config', async () => {
    const cfg = withExtensions({
      name: 'gh-stack',
      deliver: { 'claude-code': { via: 'skills', repo: 'github/gh-stack' }, opencode: 'skip' },
    })
    const plan = await buildOpencodePlan(ctxFor(cfg))
    expect(plan.groups.some((g) => g.section === 'opencode config')).toBe(false)
    expect(installs(plan)).toEqual([])
  })
})
