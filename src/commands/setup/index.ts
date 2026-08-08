import pc from 'picocolors'
import type { Command } from '../index'
import { agents } from './agents'

/** One entry per thing this machine can be set up from `config.ts`. */
const targets: Record<string, Command> = {
  [agents.name]: agents,
}

const USAGE = `Usage: pakhale setup <target> [options]

Set up part of this machine from the declarations in config.ts.

Targets:
${Object.values(targets)
  .map((t) => `  ${t.name.padEnd(10)} ${t.describe}`)
  .join('\n')}

Run \`pakhale setup <target> --help\` for a target's own options.`

export const setup: Command = {
  name: 'setup',
  describe: 'set up this machine from config.ts',

  async run(argv, packageRoot) {
    const [name, ...rest] = argv

    if (!name) {
      console.error(pc.red('setup needs a target\n'))
      console.log(USAGE)
      return 1
    }

    if (name === '--help' || name === '-h') {
      console.log(USAGE)
      return 0
    }

    const target = targets[name]
    if (!target) {
      console.error(pc.red(`unknown setup target: ${name}\n`))
      console.log(USAGE)
      return 1
    }

    return target.run(rest, packageRoot)
  },
}
