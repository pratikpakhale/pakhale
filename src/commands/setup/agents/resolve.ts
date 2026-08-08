import pc from 'picocolors'
import { isInteractive, select, type Choice } from '../../../util/prompt'
import type { Conflict } from './diff'

export type Resolution = 'apply' | 'keep'
export type Resolver = (conflict: Conflict) => Promise<Resolution>

/** `--force`: the config wins every conflict, exactly as if each prompt answered "use config". */
export const forceResolver: Resolver = async () => 'apply'

/** No one to ask — keep what the machine has, dpkg's default for the same reason. */
export const keepResolver: Resolver = async () => 'keep'

export function defaultResolver(): Resolver {
  return isInteractive() ? interactiveResolver() : keepResolver
}

/**
 * One question per conflict, dpkg-conffile style: keep / take the config's / see the diff
 * first. The "all remaining" answers stick for the rest of the run — the whole run, not one
 * plan, which is why the resolver is created once in `applyAgents` and threaded down.
 */
type Ask = (message: string, choices: Choice[]) => Promise<string | null>

export function interactiveResolver(ask: Ask = select): Resolver {
  let rest: Resolution | null = null

  return async (conflict) => {
    if (rest) return rest

    for (;;) {
      const choice = await ask(`${conflict.label} — ${conflict.summary}`, [
        { value: 'keep', label: 'Keep what this machine has', hint: 'asks again next run' },
        { value: 'apply', label: "Use the config's version", hint: 'existing is backed up' },
        ...(conflict.diffText ? [{ value: 'diff', label: 'Show the diff first' }] : []),
        { value: 'keep-all', label: 'Keep — here and for every remaining conflict' },
        { value: 'apply-all', label: 'Use config — here and for every remaining conflict' },
      ])

      switch (choice) {
        case 'diff':
          printDiff(conflict.diffText)
          continue
        case 'apply':
          return 'apply'
        case 'apply-all':
          return (rest = 'apply')
        case 'keep-all':
        case null: // cancelled — stop asking, touch nothing contested
          return (rest = 'keep')
        default:
          return 'keep'
      }
    }
  }
}

function printDiff(text: string) {
  for (const line of text.split('\n')) {
    if (line.startsWith('+')) console.log(`  ${pc.green(line)}`)
    else if (line.startsWith('-')) console.log(`  ${pc.red(line)}`)
    else if (line.startsWith('@@')) console.log(`  ${pc.cyan(line)}`)
    else console.log(`  ${pc.dim(line)}`)
  }
}
