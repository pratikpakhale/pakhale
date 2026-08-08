import { log } from '../../../util/log'
import type {
  AgentId,
  ClaudePluginDelivery,
  Delivery,
  Extension,
  McpServer,
  SetupConfig,
  SkillsDelivery,
} from './types'

/** The delivery an extension uses on one agent, or null when it deliberately reaches none. */
export function deliveryFor(extension: Extension, agent: AgentId): Delivery | null {
  const declared = extension.deliver[agent] ?? extension.deliver.all
  if (!declared) throw new Error(`extension "${extension.name}" declares no delivery for ${agent}`)
  return typeof declared === 'string' ? null : declared
}

export function skillDeliveries(config: SetupConfig, agent: AgentId): SkillsDelivery[] {
  const out: SkillsDelivery[] = []
  for (const extension of config.extensions) {
    const delivery = deliveryFor(extension, agent)
    if (delivery?.via === 'skills') out.push(delivery)
  }
  return out
}

export function claudePluginDeliveries(config: SetupConfig): ClaudePluginDelivery[] {
  const out: ClaudePluginDelivery[] = []
  for (const extension of config.extensions) {
    const delivery = deliveryFor(extension, 'claude-code')
    if (delivery?.via === 'claude-plugin') out.push(delivery)
  }
  return out
}

export function opencodePluginPackages(config: SetupConfig): string[] {
  const out: string[] = []
  for (const extension of config.extensions) {
    const delivery = deliveryFor(extension, 'opencode')
    if (delivery?.via === 'opencode-plugin') out.push(delivery.package)
  }
  return out
}

/** MCP servers this agent should run, keyed by extension name. */
export function mcpServersFor(config: SetupConfig, agent: AgentId): Record<string, McpServer> {
  const out: Record<string, McpServer> = {}
  for (const extension of config.extensions) {
    const delivery = deliveryFor(extension, agent)
    if (delivery?.via === 'mcp') out[extension.name] = delivery.server
  }
  return out
}

/**
 * Every extension must resolve on every configured agent, and every `claude-plugin` delivery
 * must name a declared marketplace. Runs before any emitter so a gap fails the whole run
 * rather than silently under-installing one agent.
 */
export function validateExtensions(config: SetupConfig) {
  const problems: string[] = []

  for (const extension of config.extensions) {
    for (const agent of config.agents) {
      if (!(extension.deliver[agent] ?? extension.deliver.all)) {
        problems.push(
          `${extension.name}: no delivery for ${agent} — add one, or "unsupported"/"skip"`,
        )
      }
    }

    for (const [key, delivery] of Object.entries(extension.deliver)) {
      if (key !== 'all' && !config.agents.includes(key as AgentId)) {
        problems.push(`${extension.name}: delivery for "${key}", which is not in config.agents`)
      }
      if (typeof delivery === 'object' && delivery.via === 'claude-plugin') {
        if (!config.marketplaces[delivery.marketplace]) {
          problems.push(`${extension.name}: unknown marketplace "${delivery.marketplace}"`)
        }
      }
    }
  }

  if (problems.length) {
    throw new Error(`config.extensions is incomplete:\n  - ${problems.join('\n  - ')}`)
  }
}

/** One line per extension showing how it reaches each agent — "does X cover opencode?". */
export function logCoverage(config: SetupConfig) {
  log.section('Extensions')

  const rows = config.extensions.map((extension) => ({
    name: extension.name,
    cells: config.agents.map((agent) => {
      const declared = extension.deliver[agent] ?? extension.deliver.all
      return `${agent} → ${typeof declared === 'string' ? declared : declared!.via}`
    }),
  }))
  const nameWidth = Math.max(...rows.map((r) => r.name.length))
  const cellWidths = config.agents.map((_, i) => Math.max(...rows.map((r) => r.cells[i]!.length)))

  for (const { name, cells } of rows) {
    const line = cells.map((c, i) => c.padEnd(cellWidths[i]!)).join('   ')
    log.info(`${name.padEnd(nameWidth)}   ${line.trimEnd()}`)
  }
}
