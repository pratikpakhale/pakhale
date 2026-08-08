import { join } from 'node:path'
import { exists } from '../../../../util/fs'
import { mcpServersFor, opencodePluginPackages } from '../extensions'
import { skillInstalls } from '../installs'
import type { ArtifactGroup, Plan } from '../plan'
import { stateFileFor } from '../state'
import type { EmitContext, Emitter, McpServer, SetupConfig } from '../types'

const CONFIG_DIR = '.config/opencode'
/** opencode accepts either name; write to whichever already exists so we never fork the config. */
const CONFIG_FILES = ['opencode.jsonc', 'opencode.json']

export const opencode: Emitter = {
  id: 'opencode',
  configDir: CONFIG_DIR,
  buildPlan,
}

export async function buildPlan(ctx: EmitContext): Promise<Plan> {
  const root = join(ctx.home, CONFIG_DIR)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  const groups: ArtifactGroup[] = [
    {
      section: 'Skills (remote)',
      artifacts: skillInstalls(ctx.config, 'opencode', ctx.home),
    },
    {
      section: 'Instructions',
      artifacts: [
        {
          kind: 'file',
          src: join(ctx.repoRoot, ctx.config.instructionsFile),
          dest: join(root, 'AGENTS.md'),
        },
      ],
    },
  ]

  const derived = configKeys(ctx.config)
  if (Object.keys(derived).length) {
    groups.push({
      section: 'opencode config',
      artifacts: [{ kind: 'jsonMerge', dest: await configPath(root), managed: {}, derived }],
    })
  }

  return { archiveDir: join(root, '.setup-backups', stamp), stateFile: stateFileFor(ctx.home), groups }
}

async function configPath(root: string) {
  for (const name of CONFIG_FILES) {
    if (await exists(join(root, name))) return join(root, name)
  }
  return join(root, CONFIG_FILES[1]!)
}

function configKeys(config: SetupConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const plugin = opencodePluginPackages(config)
  if (plugin.length) out.plugin = plugin

  const servers = Object.entries(mcpServersFor(config, 'opencode'))
  if (servers.length) {
    out.mcp = Object.fromEntries(servers.map(([name, server]) => [name, opencodeMcp(server)]))
  }

  return out
}

function opencodeMcp(server: McpServer) {
  return server.transport === 'stdio'
    ? {
        type: 'local',
        command: server.command,
        enabled: true,
        ...(server.env && { environment: server.env }),
      }
    : {
        type: 'remote',
        url: server.url,
        enabled: true,
        ...(server.headers && { headers: server.headers }),
      }
}
