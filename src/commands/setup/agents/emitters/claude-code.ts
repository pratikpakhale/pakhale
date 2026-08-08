import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { claudePluginDeliveries, mcpServersFor } from '../extensions'
import { claudePluginInstalls, skillInstalls } from '../installs'
import type { Artifact, ArtifactGroup, Plan } from '../plan'
import { AGENTS_STORE, authoredSkillNames } from '../store'
import type {
  ClaudeCodeConfig,
  ClaudePluginDelivery,
  EmitContext,
  Emitter,
  Marketplace,
  McpServer,
} from '../types'

const CONFIG_DIR = '.claude'
const ARCHIVE_DIR = '.setup-backups'

export const claudeCode: Emitter = {
  id: 'claude-code',
  configDir: CONFIG_DIR,
  buildPlan,
}

export async function buildPlan(ctx: EmitContext): Promise<Plan> {
  const root = join(ctx.home, CONFIG_DIR)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveDir = join(root, ARCHIVE_DIR, stamp)
  const cc = ctx.config.claudeCode
  const statuslinePath = join(root, 'statusline-command.sh')
  const plugins = claudePluginDeliveries(ctx.config)

  const groups: ArtifactGroup[] = [
    {
      section: 'Plugins',
      artifacts: claudePluginInstalls(ctx.config, ctx.home),
    },
    {
      section: 'Skills (remote)',
      artifacts: skillInstalls(ctx.config, 'claude-code', ctx.home, join(root, 'skills')),
    },
    {
      section: 'Skills (authored)',
      artifacts: await authoredSkillLinks(ctx, root, archiveDir),
    },
    {
      section: 'Instructions & statusline',
      artifacts: [
        {
          kind: 'file',
          src: join(ctx.repoRoot, ctx.config.instructionsFile),
          dest: join(root, 'CLAUDE.md'),
        },
        {
          kind: 'file',
          src: join(ctx.repoRoot, cc.statuslineScript),
          dest: statuslinePath,
          mode: 0o755,
        },
      ],
    },
    {
      section: 'settings.json',
      artifacts: [
        {
          kind: 'jsonMerge',
          dest: join(root, 'settings.json'),
          managed: settingsFor(cc),
          derived: {
            statusLine: { type: 'command', command: `bash ${statuslinePath}` },
            enabledPlugins: enabledPluginsMap(plugins),
            extraKnownMarketplaces: marketplacesMap(plugins, ctx.config.marketplaces),
          },
        },
      ],
    },
  ]

  const mcpServers = mcpServersFor(ctx.config, 'claude-code')
  if (Object.keys(mcpServers).length) {
    groups.push({
      section: '~/.claude.json',
      artifacts: [
        {
          kind: 'jsonMerge',
          dest: join(ctx.home, '.claude.json'),
          managed: {},
          derived: { mcpServers: mapValues(mcpServers, claudeMcp) },
        },
      ],
    })
  }

  if (cc.commandsDir) {
    groups.push({
      section: 'Commands',
      artifacts: await commandFiles(ctx.repoRoot, cc.commandsDir, root),
    })
  }

  return { archiveDir, groups }
}

export function enabledPluginsMap(deliveries: ClaudePluginDelivery[]) {
  return Object.fromEntries(deliveries.map((d) => [`${d.plugin}@${d.marketplace}`, true]))
}

export function marketplacesMap(
  deliveries: ClaudePluginDelivery[],
  marketplaces: Record<string, Marketplace>,
) {
  const referenced = [...new Set(deliveries.map((d) => d.marketplace))]
  return Object.fromEntries(
    referenced
      .filter((name) => !marketplaces[name]!.builtin)
      .map((name) => [name, { source: { source: 'github', repo: marketplaces[name]!.repo } }]),
  )
}

function claudeMcp(server: McpServer) {
  return server.transport === 'stdio'
    ? {
        type: 'stdio',
        command: server.command[0],
        args: server.command.slice(1),
        ...(server.env && { env: server.env }),
      }
    : { type: 'http', url: server.url, ...(server.headers && { headers: server.headers }) }
}

function mapValues<T, R>(record: Record<string, T>, fn: (value: T) => R): Record<string, R> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fn(v)]))
}

async function authoredSkillLinks(
  ctx: EmitContext,
  root: string,
  archiveDir: string,
): Promise<Artifact[]> {
  return (await authoredSkillNames(ctx)).map<Artifact>((name) => ({
    kind: 'symlink',
    target: `../../${AGENTS_STORE}/${name}`,
    linkPath: join(root, 'skills', name),
    archiveDisplaced: join(archiveDir, 'agent-skills'),
  }))
}

async function commandFiles(repoRoot: string, dir: string, root: string): Promise<Artifact[]> {
  const src = resolve(repoRoot, dir)
  return (await readdir(src))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map<Artifact>((f) => ({ kind: 'file', src: join(src, f), dest: join(root, 'commands', f) }))
}

function settingsFor(cc: ClaudeCodeConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (cc.effort !== undefined) out.effortLevel = cc.effort
  if (cc.autoCompactWindow !== undefined) out.autoCompactWindow = cc.autoCompactWindow
  if (cc.tui !== undefined) out.tui = cc.tui
  if (cc.cleanupPeriodDays !== undefined) out.cleanupPeriodDays = cc.cleanupPeriodDays
  if (cc.voice !== undefined) out.voiceEnabled = cc.voice
  if (cc.autoDream !== undefined) out.autoDreamEnabled = cc.autoDream
  if (cc.agentPushNotifications !== undefined) out.agentPushNotifEnabled = cc.agentPushNotifications
  if (cc.permissions?.defaultMode !== undefined)
    out.permissions = { defaultMode: cc.permissions.defaultMode }
  if (cc.permissions?.skipDangerousModePrompt !== undefined)
    out.skipDangerousModePermissionPrompt = cc.permissions.skipDangerousModePrompt
  if (cc.permissions?.skipAutoPrompt !== undefined)
    out.skipAutoPermissionPrompt = cc.permissions.skipAutoPrompt
  if (cc.hooks !== undefined) out.hooks = cc.hooks
  return out
}
