import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import { config } from '../../../../config'
import { log } from '../../../util/log'
import { isInteractive, multiSelect, shouldAsk } from '../../../util/prompt'
import type { Command } from '../../index'
import { applyAgents, isInstalled } from './apply'
import { emitters } from './emitters'
import type { AgentId, EmitContext } from './types'

const USAGE = `Usage: pakhale setup agents [plan] [options]

Apply the coding-agent workflow (plugins, skills, settings) to this machine.
With a terminal and no --agent, you are asked which agents to apply to; piped or
scripted runs apply to every configured agent.

  plan               dry run — show every change, write nothing

Options:
  -n, --dry-run      same as plan
  -a, --agent <id>   target one agent (repeatable) — skips the prompt
      --all          every configured agent — skips the prompt
      --home <dir>   apply against a different home directory
  -h, --help         show this help`

export const agents: Command = {
  name: 'agents',
  describe: 'apply the coding-agent workflow (plugins, skills, settings) to this machine',

  async run(argv, packageRoot) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', short: 'n', default: false },
        agent: { type: 'string', short: 'a', multiple: true },
        all: { type: 'boolean', default: false },
        home: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    })

    if (values.help) {
      console.log(USAGE)
      return 0
    }

    const dryRun = values['dry-run'] || positionals.includes('plan')
    const home = values.home ? resolve(values.home) : homedir()
    const only = (values.agent ?? []) as AgentId[]

    const available = (only.length ? only : config.agents).filter((id) => {
      if (emitters[id]) return true
      log.warn(`no emitter for "${id}" yet — skipping`)
      return false
    })

    const asking = shouldAsk({
      requested: only.length,
      all: values.all,
      interactive: isInteractive(),
    })
    const selected = asking ? await chooseAgents(available, home) : available

    if (!selected.length) {
      log.fail('nothing to do')
      return 1
    }

    const mode = dryRun ? ` ${pc.yellow('(dry run)')}` : ''
    const where = home === homedir() ? '' : ` ${pc.magenta(`[home=${home}]`)}`
    console.log(`\npakhale setup agents${mode}${where} → ${selected.join(', ')}`)

    const ctx: EmitContext = { home, repoRoot: packageRoot, config }
    await applyAgents(ctx, selected, dryRun)

    console.log(
      dryRun ? `\n${pc.yellow('dry run complete — nothing written')}\n` : `\n${pc.green('done')}\n`,
    )
    return 0
  },
}

async function chooseAgents(ids: AgentId[], home: string): Promise<AgentId[]> {
  const choices = await Promise.all(
    ids.map(async (id) => ({
      value: id,
      label: id,
      hint: (await isInstalled(home, emitters[id]!)) ? '' : 'not installed here',
    })),
  )
  return (await multiSelect('Which agents?', choices)) as AgentId[]
}
