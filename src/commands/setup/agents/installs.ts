import { join } from 'node:path'
import { claudePluginDeliveries, skillDeliveries } from './extensions'
import type { InstallArtifact } from './plan'
import type { AgentId, SetupConfig } from './types'

const SKILL_LOCK = '.agents/.skill-lock.json'
const MARKETPLACE_REGISTRY = '.claude/plugins/known_marketplaces.json'

/**
 * `claude plugin` installs, preceded by the marketplaces they come from. Each marketplace
 * appears once however many plugins reference it; built-in ones ship with Claude Code.
 */
export function claudePluginInstalls(config: SetupConfig, home: string): InstallArtifact[] {
  const out: InstallArtifact[] = []
  const added = new Set<string>()

  for (const { marketplace, plugin } of claudePluginDeliveries(config)) {
    const market = config.marketplaces[marketplace]!
    if (!market.builtin && !added.has(marketplace)) {
      added.add(marketplace)
      out.push({
        kind: 'install',
        label: `marketplace ${marketplace}`,
        requires: 'claude',
        command: ['claude', 'plugin', 'marketplace', 'add', market.repo],
        probe: {
          kind: 'claude-marketplace',
          name: marketplace,
          registryFile: join(home, MARKETPLACE_REGISTRY),
        },
      })
    }

    const id = `${plugin}@${marketplace}`
    out.push({
      kind: 'install',
      label: id,
      requires: 'claude',
      command: ['claude', 'plugin', 'install', id],
      probe: { kind: 'claude-plugin', id },
    })
  }

  return out
}

/**
 * `linkDir` is where *this* agent expects to find each skill afterwards — the shared store
 * itself for agents that read it directly. Always pass it: `.skill-lock.json` is one
 * agent-agnostic file, so a name-only probe is satisfied by whichever agent installed first
 * and every later agent's install is skipped forever, silently reporting `unchanged`.
 */
export function skillInstalls(
  config: SetupConfig,
  agent: AgentId,
  home: string,
  linkDir?: string,
): InstallArtifact[] {
  return skillDeliveries(config, agent).map((delivery) => {
    const command = ['npx', '-y', 'skills', 'add', delivery.repo, '-g', '-y', '-a', agent]
    if (delivery.skills?.length) command.push('-s', ...delivery.skills)

    return {
      kind: 'install',
      label: `${delivery.repo} (${delivery.skills?.length ?? 'all'})`,
      requires: 'npx',
      command,
      probe: {
        kind: 'skills',
        lockFile: join(home, SKILL_LOCK),
        names: delivery.skills ?? [],
        ...(linkDir && { linkDir }),
      },
    }
  })
}
