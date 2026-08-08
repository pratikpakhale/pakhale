import { describe, expect, test } from 'bun:test'
import type { Conflict } from '../src/commands/setup/agents/diff'
import { interactiveResolver } from '../src/commands/setup/agents/resolve'
import type { Choice } from '../src/util/prompt'

/**
 * The prompt widget itself is @clack/prompts and cannot be driven from a test; what is
 * pinned here is every decision around it — which options are offered, how "…all
 * remaining" sticks, and that cancelling stops the asking without touching anything.
 */

function conflict(over: Partial<Conflict> = {}): Conflict {
  return {
    status: 'conflict',
    label: '~/x',
    summary: 'has content setup did not write',
    diffText: '-theirs\n+ours',
    apply: { action: { do: 'write-file', src: 's', dest: 'd' } },
    keep: null,
    ...over,
  }
}

/** Feeds scripted answers and records every question's option values. */
function script(answers: (string | null)[]) {
  const asked: string[][] = []
  const ask = async (_message: string, choices: Choice[]) => {
    asked.push(choices.map((c) => c.value))
    const next = answers.shift()
    if (next === undefined) throw new Error('asked more than scripted')
    return next
  }
  return { ask, asked }
}

describe('interactiveResolver', () => {
  test('offers keep, apply, diff and both sticky variants for a diffable conflict', async () => {
    const { ask, asked } = script(['keep'])

    await interactiveResolver(ask)(conflict())

    expect(asked).toEqual([['keep', 'apply', 'diff', 'keep-all', 'apply-all']])
  })

  test('omits the diff option when there is nothing to show', async () => {
    const { ask, asked } = script(['apply'])

    const resolution = await interactiveResolver(ask)(conflict({ diffText: '' }))

    expect(resolution).toBe('apply')
    expect(asked).toEqual([['keep', 'apply', 'keep-all', 'apply-all']])
  })

  test('showing the diff loops back to the same question until answered', async () => {
    const { ask, asked } = script(['diff', 'diff', 'apply'])

    const resolution = await interactiveResolver(ask)(conflict())

    expect(resolution).toBe('apply')
    expect(asked.length).toBe(3)
  })

  test('apply-all answers this conflict and every later one without asking again', async () => {
    const { ask, asked } = script(['apply-all'])
    const resolve = interactiveResolver(ask)

    expect(await resolve(conflict())).toBe('apply')
    expect(await resolve(conflict({ label: '~/y' }))).toBe('apply')
    expect(await resolve(conflict({ label: '~/z' }))).toBe('apply')
    expect(asked.length).toBe(1)
  })

  test('keep-all sticks the same way', async () => {
    const { ask, asked } = script(['keep-all'])
    const resolve = interactiveResolver(ask)

    expect(await resolve(conflict())).toBe('keep')
    expect(await resolve(conflict({ label: '~/y' }))).toBe('keep')
    expect(asked.length).toBe(1)
  })

  test('cancelling means keep, and stops the asking for the rest of the run', async () => {
    const { ask, asked } = script([null])
    const resolve = interactiveResolver(ask)

    expect(await resolve(conflict())).toBe('keep')
    expect(await resolve(conflict({ label: '~/y' }))).toBe('keep')
    expect(asked.length).toBe(1)
  })

  test('plain answers do not stick — the next conflict is its own question', async () => {
    const { ask, asked } = script(['apply', 'keep'])
    const resolve = interactiveResolver(ask)

    expect(await resolve(conflict())).toBe('apply')
    expect(await resolve(conflict({ label: '~/y' }))).toBe('keep')
    expect(asked.length).toBe(2)
  })
})
