import { join } from 'node:path'
import { exists } from '../../../util/fs'
import { log } from '../../../util/log'
import { emitters } from './emitters'
import { runPlan } from './executor'
import { logCoverage, validateExtensions } from './extensions'
import { defaultResolver, type Resolver } from './resolve'
import { buildStorePlan } from './store'
import type { AgentId, EmitContext, Emitter } from './types'

/** An agent with no config directory is not on this machine — skip it, never create it. */
export function isInstalled(home: string, emitter: Emitter) {
  return exists(join(home, emitter.configDir))
}

export async function applyAgents(
  ctx: EmitContext,
  ids: AgentId[],
  dryRun: boolean,
  // One resolver for the whole run, so an "…all remaining" answer holds across agents.
  resolve: Resolver = defaultResolver(),
) {
  validateExtensions(ctx.config)
  logCoverage(ctx.config)

  await runPlan(await buildStorePlan(ctx), dryRun, resolve)

  for (const id of ids) {
    const emitter = emitters[id]
    if (!emitter) continue
    log.agent(id)
    if (!(await isInstalled(ctx.home, emitter))) {
      log.warn(`${id} not installed on this machine — skipping`)
      continue
    }
    await runPlan(await emitter.buildPlan(ctx), dryRun, resolve)
  }
}
