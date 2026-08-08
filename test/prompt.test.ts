import { describe, expect, test } from 'bun:test'
import { multiSelect, shouldAsk } from '../src/util/prompt'

describe('shouldAsk', () => {
  test('asks when nothing was requested and a terminal is attached', () => {
    expect(shouldAsk({ requested: 0, all: false, interactive: true })).toBe(true)
  })

  test('never asks without a terminal — a piped run would hang', () => {
    expect(shouldAsk({ requested: 0, all: false, interactive: false })).toBe(false)
  })

  test('--agent and --all are already an answer', () => {
    expect(shouldAsk({ requested: 1, all: false, interactive: true })).toBe(false)
    expect(shouldAsk({ requested: 0, all: true, interactive: true })).toBe(false)
  })
})

describe('multiSelect', () => {
  test('nothing to choose from means no prompt at all', async () => {
    expect(await multiSelect('Which agents?', [])).toEqual([])
  })
})
