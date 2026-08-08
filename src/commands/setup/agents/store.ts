import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Artifact, Plan } from './plan'
import { stateFileFor } from './state'
import type { EmitContext } from './types'

export const AGENTS_STORE = '.agents/skills'

export async function authoredSkillNames(ctx: EmitContext): Promise<string[]> {
  const src = join(ctx.repoRoot, ctx.config.authoredSkillsDir)
  return (await readdir(src, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

export async function buildStorePlan(ctx: EmitContext): Promise<Plan> {
  const src = join(ctx.repoRoot, ctx.config.authoredSkillsDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveDir = join(ctx.home, '.agents/.setup-backups', stamp)

  return {
    archiveDir,
    stateFile: stateFileFor(ctx.home),
    groups: [
      {
        section: 'Skills store (~/.agents/skills)',
        artifacts: (await authoredSkillNames(ctx)).map<Artifact>((name) => ({
          kind: 'symlink',
          target: join(src, name),
          linkPath: join(ctx.home, AGENTS_STORE, name),
          archiveDisplaced: join(archiveDir, 'skills'),
        })),
      },
    ],
  }
}
