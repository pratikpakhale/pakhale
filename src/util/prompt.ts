import { cancel, isCancel, multiselect } from '@clack/prompts'

export interface Choice {
  value: string
  label: string
  hint?: string
}

/** Space to toggle, `a` for all, enter to confirm. Cancelling selects nothing. */
export async function multiSelect(message: string, choices: Choice[]): Promise<string[]> {
  if (!choices.length) return []

  const picked = await multiselect({
    message,
    options: choices.map((c) => ({ value: c.value, label: c.label, hint: c.hint })),
    initialValues: choices.map((c) => c.value),
    required: false,
  })

  if (isCancel(picked)) {
    cancel('cancelled')
    return []
  }
  return picked
}

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * Ask only when the user has not already decided and someone is there to answer. A prompt in
 * a piped or scripted run would hang forever, so this is the one gate that must not regress.
 */
export function shouldAsk(opts: { requested: number; all: boolean; interactive: boolean }) {
  return opts.requested === 0 && !opts.all && opts.interactive
}
