/**
 * Fresh-eyes black-box suite for conflict resolution, written from ARCHITECTURE.md
 * ("Conflicts", "Safety") and the source of diff/state/resolve/executor — deliberately
 * NOT from the existing tests.
 *
 * Expectations pinned here, with their documentation source:
 *  - dpkg-conffile rule: machine ≠ config is a conflict only when the machine also
 *    differs from the last-written record (ARCHITECTURE.md "Conflicts").
 *  - "Config edits converge silently; live machine edits and foreign files prompt."
 *  - apply = config wins, displaced version always backed up; keep = machine wins,
 *    and for jsonMerge the uncontested changes still land.
 *  - "Keep" is per-run: a kept conflict asks again next run, never silently adopted.
 *  - Deleting the state file is safe: next apply just asks about everything that differs.
 *  - Converged means no-op; dry-run writes nothing and never resolves.
 *  - "Merge, never clobber": unmanaged keys preserved; nothing overwritten silently.
 *  - "A config that will not parse is left alone, rather than silently flattened."
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyAgents } from '../src/commands/setup/agents/apply'
import { diff, type Conflict } from '../src/commands/setup/agents/diff'
import { buildPlan as buildClaudePlan } from '../src/commands/setup/agents/emitters/claude-code'
import {
  forceResolver,
  interactiveResolver,
  keepResolver,
  type Resolution,
  type Resolver,
} from '../src/commands/setup/agents/resolve'
import { hashContent, loadState, stateFileFor } from '../src/commands/setup/agents/state'
import { buildStorePlan } from '../src/commands/setup/agents/store'
import type { EmitContext, SetupConfig } from '../src/commands/setup/agents/types'
import type { Choice } from '../src/util/prompt'
import { config } from '../config'
import { makeSandbox, type Sandbox } from './sandbox'

// ─── fixture ────────────────────────────────────────────────────────────────

/** Real config minus extensions: no installers, so runs are pure file/json/symlink. */
const BASE: SetupConfig = { ...config, extensions: [] }

const INSTRUCTIONS_V1 = 'instructions v1\n'
const SETTINGS = '.claude/settings.json'
const CLAUDEMD = '.claude/CLAUDE.md'
const STATE = '.agents/.setup-state.json'

interface Fixture {
  sbx: Sandbox
  ctx: EmitContext
  repo: string
}

/** Sandbox HOME plus a tiny fake repo checkout, so authored content is fully controlled. */
async function fixture(cfg: SetupConfig = BASE): Promise<Fixture> {
  const sbx = await makeSandbox()
  const repo = join(sbx.root, 'repo')
  await mkdir(join(repo, 'skills', 'demo-skill'), { recursive: true })
  await writeFile(join(repo, 'skills', 'demo-skill', 'SKILL.md'), '# demo skill\n')
  await mkdir(join(repo, 'assets', 'instructions'), { recursive: true })
  await writeFile(join(repo, 'assets', 'instructions', 'AGENTS.md'), INSTRUCTIONS_V1)
  await mkdir(join(repo, 'assets', 'statusline'), { recursive: true })
  await writeFile(join(repo, 'assets', 'statusline', 'claude-code.sh'), '#!/bin/sh\necho ok\n')
  return { sbx, repo, ctx: { home: sbx.home, repoRoot: repo, config: cfg } }
}

function withClaudeCode(overrides: Partial<SetupConfig['claudeCode']>): SetupConfig {
  return { ...BASE, claudeCode: { ...BASE.claudeCode, ...overrides } }
}

// ─── resolvers for tests ────────────────────────────────────────────────────

/** Fails the test the moment anything asks — for runs that must not conflict. */
function neverResolve(): Resolver {
  return async (c) => {
    throw new Error(`unexpected conflict prompt: ${c.label} — ${c.summary}`)
  }
}

/** Answers from a script, recording every conflict it was shown. */
function scripted(answers: Resolution[], seen: Conflict[] = []): Resolver {
  return async (c) => {
    seen.push(c)
    const next = answers.shift()
    if (next === undefined) throw new Error(`no scripted answer left for: ${c.label}`)
    return next
  }
}

const apply = (f: Fixture, resolver: Resolver, dryRun = false, ids: ('claude-code' | 'opencode')[] = ['claude-code']) =>
  applyAgents(f.ctx, ids, dryRun, resolver)

// ─── helpers ────────────────────────────────────────────────────────────────

async function editSettings(sbx: Sandbox, mutate: (s: Record<string, unknown>) => void) {
  const s = await sbx.json<Record<string, unknown>>(SETTINGS)
  mutate(s)
  await writeFile(join(sbx.home, SETTINGS), `${JSON.stringify(s, null, 2)}\n`)
}

/** Full content snapshot of HOME — file bytes, symlink targets, directory names. */
async function snapshot(sbx: Sandbox): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await sbx.tree()) {
    out[entry] =
      entry.endsWith('/') || entry.includes(' -> ') ? entry : await sbx.read(entry)
  }
  return out
}

async function backupsUnder(sbx: Sandbox, dir: string): Promise<string[]> {
  return (await sbx.tree(dir)).filter((e) => !e.endsWith('/'))
}

// ═══ fresh machine & state seeding ══════════════════════════════════════════

describe('fresh machine and state seeding', () => {
  test('first apply provisions files, links and settings, and seeds the state record', async () => {
    const f = await fixture()
    await apply(f, neverResolve())

    expect(await f.sbx.read(CLAUDEMD)).toBe(INSTRUCTIONS_V1)
    const settings = await f.sbx.json<Record<string, unknown>>(SETTINGS)
    expect(settings.autoCompactWindow).toBe(250000)
    expect(settings.voiceEnabled).toBe(true)
    expect(settings.permissions).toEqual({ defaultMode: 'auto', deny: ['Artifact'] })
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: `bash ${join(f.sbx.home, '.claude', 'statusline-command.sh')}`,
    })

    const tree = await f.sbx.tree()
    expect(tree).toContain(`.agents/skills/demo-skill -> ${join(f.repo, 'skills', 'demo-skill')}`)
    expect(tree).toContain('.claude/skills/demo-skill -> ../../.agents/skills/demo-skill')

    const state = await f.sbx.json<{ files: Record<string, string>; keys: Record<string, Record<string, string>> }>(STATE)
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBe(hashContent(INSTRUCTIONS_V1))
    expect(state.files[join(f.sbx.home, '.claude', 'statusline-command.sh')]).toBeDefined()
    const settingsKeys = state.keys[join(f.sbx.home, SETTINGS)]
    expect(settingsKeys).toBeDefined()
    expect(Object.keys(settingsKeys!)).toContain('autoCompactWindow')
    expect(Object.keys(settingsKeys!)).toContain('statusLine')
  })

  test('converged means no-op: a second apply changes nothing on disk', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    const before = await snapshot(f.sbx)
    await apply(f, neverResolve())
    expect(await snapshot(f.sbx)).toEqual(before)
    // and no backup directories appeared out of nowhere
    expect(await backupsUnder(f.sbx, '.claude/.setup-backups')).toEqual([])
  })

  test('after apply, diff() reports every artifact unchanged (plan-after-apply invariant)', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    const state = await loadState(stateFileFor(f.sbx.home))
    for (const plan of [await buildStorePlan(f.ctx), await buildClaudePlan(f.ctx)]) {
      for (const section of await diff(plan, state)) {
        for (const change of section.changes) {
          expect(`${section.title}: ${change.label} → ${change.status}`).toBe(
            `${section.title}: ${change.label} → unchanged`,
          )
        }
      }
    }
  })

  test('a pre-existing file already identical to config is adopted silently and seeded', async () => {
    const f = await fixture()
    await writeFile(join(f.sbx.home, CLAUDEMD), INSTRUCTIONS_V1)
    await apply(f, neverResolve()) // no prompt: content matches config
    const state = await loadState(stateFileFor(f.sbx.home))
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBe(hashContent(INSTRUCTIONS_V1))

    // ...and thanks to that seeding, a later live edit is detected as a conflict
    await writeFile(join(f.sbx.home, CLAUDEMD), 'edited after adoption\n')
    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.label).toBe(join(f.sbx.home, CLAUDEMD))
  })
})

// ═══ dry-run purity ═════════════════════════════════════════════════════════

describe('dry-run purity', () => {
  test('dry-run writes nothing and never calls the resolver, even with conflicts pending', async () => {
    const f = await fixture()
    // plant a foreign file AND a contested settings key on a stateless machine
    await writeFile(join(f.sbx.home, CLAUDEMD), 'foreign content\n')
    await writeFile(join(f.sbx.home, SETTINGS), `${JSON.stringify({ autoCompactWindow: 1 }, null, 2)}\n`)

    const before = await snapshot(f.sbx)
    await apply(f, neverResolve(), true) // neverResolve throws if consulted
    expect(await snapshot(f.sbx)).toEqual(before)
    expect(await f.sbx.tree('.agents')).toEqual([]) // no state file, no store links
  })

  test('dry-run does not even seed state on a converged machine', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await rm(join(f.sbx.home, STATE))
    const before = await snapshot(f.sbx)
    await apply(f, neverResolve(), true)
    expect(await snapshot(f.sbx)).toEqual(before) // state file not recreated
  })
})

// ═══ config edits converge silently ═════════════════════════════════════════

describe('config edits converge silently (machine matches the record)', () => {
  test('a changed managed setting applies without prompting', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    f.ctx.config = withClaudeCode({ cleanupPeriodDays: 30 })
    await apply(f, neverResolve())
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).cleanupPeriodDays).toBe(30)
  })

  test('changed authored file content applies without prompting', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.repo, 'assets', 'instructions', 'AGENTS.md'), 'instructions v2\n')
    await apply(f, neverResolve())
    expect(await f.sbx.read(CLAUDEMD)).toBe('instructions v2\n')
  })

  test('a live edit that happens to match the new config converges without prompting', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.cleanupPeriodDays = 30 // user edits to what the new config will want anyway
    })
    f.ctx.config = withClaudeCode({ cleanupPeriodDays: 30 })
    await apply(f, neverResolve())
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).cleanupPeriodDays).toBe(30)
  })
})

// ═══ file conflicts ═════════════════════════════════════════════════════════

describe('file conflicts', () => {
  test('live edit conflicts; keep leaves the machine alone and does not touch state', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, CLAUDEMD), 'my local notes\n')

    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('has content setup did not write')
    expect(seen[0]!.keep).toBeNull() // keeping a file is doing nothing
    expect(await f.sbx.read(CLAUDEMD)).toBe('my local notes\n')

    // state still records what setup last WROTE, not what the machine now has
    const state = await loadState(stateFileFor(f.sbx.home))
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBe(hashContent(INSTRUCTIONS_V1))
  })

  test('keep is per-run: the same conflict is asked again on the next run', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, CLAUDEMD), 'my local notes\n')
    await apply(f, scripted(['keep']))

    const seenAgain: Conflict[] = []
    await apply(f, scripted(['keep'], seenAgain))
    expect(seenAgain.length).toBe(1)
    expect(seenAgain[0]!.label).toBe(join(f.sbx.home, CLAUDEMD))
  })

  test('apply restores the config version and backs up the displaced one', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, CLAUDEMD), 'my local notes\n')
    await apply(f, scripted(['apply']))

    expect(await f.sbx.read(CLAUDEMD)).toBe(INSTRUCTIONS_V1)
    const backups = await backupsUnder(f.sbx, '.claude/.setup-backups')
    const bak = backups.find((b) => b.endsWith('CLAUDE.md'))
    expect(bak).toBeDefined()
    expect(await f.sbx.read(join('.claude/.setup-backups', bak!))).toBe('my local notes\n')

    // conflict resolved for real: next run is silent
    await apply(f, neverResolve())
  })

  test('a file emptied live is still a conflict, and keep keeps it empty', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, CLAUDEMD), '')
    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(await f.sbx.read(CLAUDEMD)).toBe('')
  })

  test('foreign file on a stateless machine conflicts; the piped default keeps it', async () => {
    const f = await fixture()
    await writeFile(join(f.sbx.home, CLAUDEMD), 'was here first\n')
    await apply(f, keepResolver) // what a piped run does

    expect(await f.sbx.read(CLAUDEMD)).toBe('was here first\n') // kept
    // the rest of the plan still landed
    expect((await f.sbx.tree()).includes('.claude/settings.json')).toBe(true)
    // and the kept file was NOT adopted into state
    const state = await loadState(stateFileFor(f.sbx.home))
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBeUndefined()
  })

  test('deleting a setup-written file is a live machine edit, so it must prompt', async () => {
    // ARCHITECTURE.md: "live machine edits and foreign files prompt" and "anything setup
    // did not write is a conflict". A deletion is a machine state setup did not write:
    // silently recreating it clobbers the user's decision without a prompt or a backup.
    const f = await fixture()
    await apply(f, neverResolve())
    await rm(join(f.sbx.home, CLAUDEMD))

    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1) // FINDING if 0: the file was silently recreated
  })
})

// ═══ jsonMerge conflicts ════════════════════════════════════════════════════

describe('jsonMerge conflicts', () => {
  test('unmanaged keys in a foreign settings.json are preserved without conflict', async () => {
    const f = await fixture()
    await writeFile(join(f.sbx.home, SETTINGS), `${JSON.stringify({ model: 'my-model' }, null, 2)}\n`)
    await apply(f, neverResolve()) // no managed key contested → no prompt
    const s = await f.sbx.json<Record<string, unknown>>(SETTINGS)
    expect(s.model).toBe('my-model')
    expect(s.autoCompactWindow).toBe(250000)
  })

  test('live edit to a managed key conflicts, naming exactly that key', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.autoCompactWindow = 999
    })
    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('set outside setup: autoCompactWindow')
    // nothing else to converge → keeping is doing nothing
    expect(seen[0]!.keep).toBeNull()
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).autoCompactWindow).toBe(999)
  })

  test('keep still applies the uncontested changes, and the kept key asks again next run', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.autoCompactWindow = 999 // contested: live edit
    })
    f.ctx.config = withClaudeCode({ cleanupPeriodDays: 30 }) // uncontested config change

    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('set outside setup: autoCompactWindow')
    expect(seen[0]!.keep).not.toBeNull()

    const s = await f.sbx.json<Record<string, unknown>>(SETTINGS)
    expect(s.autoCompactWindow).toBe(999) // theirs, kept
    expect(s.cleanupPeriodDays).toBe(30) // uncontested change still landed

    // per-run keep: the contested key was NOT adopted into state
    const seenAgain: Conflict[] = []
    await apply(f, scripted(['keep'], seenAgain))
    expect(seenAgain.length).toBe(1)
    expect(seenAgain[0]!.summary).toBe('set outside setup: autoCompactWindow')
  })

  test('apply on a contested key restores config and backs up the whole previous file', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.autoCompactWindow = 999
    })
    await apply(f, scripted(['apply']))

    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).autoCompactWindow).toBe(250000)
    const backups = await backupsUnder(f.sbx, '.claude/.setup-backups')
    const bak = backups.find((b) => b.endsWith('settings.json'))
    expect(bak).toBeDefined()
    const displaced = JSON.parse(await f.sbx.read(join('.claude/.setup-backups', bak!)))
    expect(displaced.autoCompactWindow).toBe(999)

    await apply(f, neverResolve()) // resolved for real
  })

  test('live edit to a derived key (statusLine) conflicts too', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.statusLine = { type: 'command', command: 'bash /my/own/line.sh' }
    })
    const seen: Conflict[] = []
    await apply(f, scripted(['apply'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('set outside setup: statusLine')
    const s = await f.sbx.json<Record<string, { command: string }>>(SETTINGS)
    expect(s.statusLine!.command).toBe(`bash ${join(f.sbx.home, '.claude', 'statusline-command.sh')}`)
  })

  test('two managed keys edited live are both contested in one conflict', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      s.autoCompactWindow = 999
      s.tui = 'inline'
    })
    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toContain('autoCompactWindow')
    expect(seen[0]!.summary).toContain('tui')
    const s = await f.sbx.json<Record<string, unknown>>(SETTINGS)
    expect(s.autoCompactWindow).toBe(999)
    expect(s.tui).toBe('inline')
  })

  test('reformatting the file without changing values is unchanged (key-order insensitive)', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    const parsed = await f.sbx.json<Record<string, unknown>>(SETTINGS)
    const reformatted = JSON.stringify(
      Object.fromEntries(Object.entries(parsed).reverse()), // same data, reversed order, one line
    )
    await writeFile(join(f.sbx.home, SETTINGS), reformatted)
    await apply(f, neverResolve())
    // unchanged means untouched: the user's formatting survives
    expect(await f.sbx.read(SETTINGS)).toBe(reformatted)
  })

  test('unparseable settings.json is blocked and left alone — even under --force', async () => {
    const f = await fixture()
    const jsonc = '// my comments\n{ "model": "x" }\n'
    await writeFile(join(f.sbx.home, SETTINGS), jsonc)
    await apply(f, forceResolver)
    expect(await f.sbx.read(SETTINGS)).toBe(jsonc)
  })

  test('an empty settings.json is blocked and left alone', async () => {
    const f = await fixture()
    await writeFile(join(f.sbx.home, SETTINGS), '')
    await apply(f, forceResolver)
    expect(await f.sbx.read(SETTINGS)).toBe('')
  })

  test('settings.json holding JSON null is left alone, not crashed on', async () => {
    // ARCHITECTURE.md: "A config that will not parse is left alone, rather than silently
    // flattened." `null` parses but is not an object; the run must survive and leave it.
    const f = await fixture()
    await writeFile(join(f.sbx.home, SETTINGS), 'null')
    await apply(f, keepResolver) // FINDING if this throws
    expect(await f.sbx.read(SETTINGS)).toBe('null')
  })

  test('settings.json holding a JSON array is left alone, not flattened into an object', async () => {
    // Same doc rule: never silently flatten. Spreading an array turns [1,2] into {"0":1,...}.
    const f = await fixture()
    await writeFile(join(f.sbx.home, SETTINGS), '[1, 2]')
    await apply(f, keepResolver)
    expect(JSON.parse(await f.sbx.read(SETTINGS))).toEqual([1, 2]) // FINDING if flattened
  })

  test('a managed key dropped from config leaves the machine value in place', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    const { voice: _voice, ...rest } = BASE.claudeCode
    f.ctx.config = { ...BASE, claudeCode: rest }
    await apply(f, neverResolve())
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).voiceEnabled).toBe(true)
  })

  test('deleting a managed key on the machine is a live edit, so it must prompt', async () => {
    // ARCHITECTURE.md: "live machine edits ... prompt" / "anything setup did not write is
    // a conflict". State records that setup wrote voiceEnabled; the machine now differs
    // from both the record and the config, which is the definition of a conflict.
    const f = await fixture()
    await apply(f, neverResolve())
    await editSettings(f.sbx, (s) => {
      delete s.voiceEnabled
    })
    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1) // FINDING if 0: deletion silently overwritten
  })
})

// ═══ state lifecycle: loss, corruption, staleness ═══════════════════════════

describe('state lifecycle', () => {
  test('state loss on a converged machine: still no prompts, and state reseeds', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await rm(join(f.sbx.home, STATE))
    await apply(f, neverResolve()) // machine == config, so nothing differs
    const state = await loadState(stateFileFor(f.sbx.home))
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBe(hashContent(INSTRUCTIONS_V1))
  })

  test('state loss + a real difference: asks about everything that differs', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await rm(join(f.sbx.home, STATE))
    f.ctx.config = withClaudeCode({ cleanupPeriodDays: 30 }) // machine holds 14, no record

    const seen: Conflict[] = []
    await apply(f, scripted(['keep'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('set outside setup: cleanupPeriodDays')
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).cleanupPeriodDays).toBe(14)
  })

  test('corrupt state file behaves as missing, not a crash', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, STATE), '{{{ not json')
    await apply(f, neverResolve()) // converged machine → silent, state rewritten valid
    const state = await f.sbx.json<{ files: Record<string, string> }>(STATE)
    expect(state.files[join(f.sbx.home, CLAUDEMD)]).toBe(hashContent(INSTRUCTIONS_V1))
  })

  test('partial state file (missing maps) is tolerated', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, STATE), '{"files": {}}')
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, STATE), '{}')
    await apply(f, neverResolve())
  })

  test('stale record: machine matches an old write, config moved on → silent converge', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    // config changes twice; machine only saw the first — but it matches the record
    f.ctx.config = withClaudeCode({ tui: 'inline' })
    await apply(f, neverResolve())
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).tui).toBe('inline')
    f.ctx.config = BASE
    await apply(f, neverResolve())
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).tui).toBe('fullscreen')
  })
})

// ═══ symlink conflicts ══════════════════════════════════════════════════════

describe('symlink conflicts', () => {
  test('a real directory where a skill link goes conflicts; apply archives it and links', async () => {
    const f = await fixture()
    const dir = join(f.sbx.home, '.claude', 'skills', 'demo-skill')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'precious.txt'), 'do not lose me\n')

    const seen: Conflict[] = []
    await apply(f, scripted(['apply'], seen))
    expect(seen.length).toBe(1)
    expect(seen[0]!.summary).toBe('a real directory sits where the link goes')
    expect(seen[0]!.keep).toBeNull()

    expect(await f.sbx.tree('.claude/skills')).toContain(
      'demo-skill -> ../../.agents/skills/demo-skill',
    )
    // the displaced directory was archived, contents intact
    const archived = (await f.sbx.tree('.claude/.setup-backups')).find((e) =>
      e.endsWith(join('agent-skills', 'demo-skill', 'precious.txt')),
    )
    expect(archived).toBeDefined()
    expect(await f.sbx.read(join('.claude/.setup-backups', archived!))).toBe('do not lose me\n')
  })

  test('keep on a directory conflict does nothing and asks again next run', async () => {
    const f = await fixture()
    const dir = join(f.sbx.home, '.claude', 'skills', 'demo-skill')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'precious.txt'), 'still here\n')

    await apply(f, scripted(['keep']))
    expect(await f.sbx.read('.claude/skills/demo-skill/precious.txt')).toBe('still here\n')

    const seenAgain: Conflict[] = []
    await apply(f, scripted(['keep'], seenAgain))
    expect(seenAgain.length).toBe(1)
  })

  test('a repointed symlink is relinked without a prompt (pinning current behavior)', async () => {
    // Not documented as a conflict — symlinks carry no state record — so today a
    // user-repointed link is silently replaced. Pinned here; see AMBIGUITIES.
    const f = await fixture()
    await apply(f, neverResolve())
    const link = join(f.sbx.home, '.claude', 'skills', 'demo-skill')
    await rm(link)
    await symlink('/somewhere/else', link)

    await apply(f, neverResolve())
    expect(await f.sbx.tree('.claude/skills')).toContain(
      'demo-skill -> ../../.agents/skills/demo-skill',
    )
  })

  test('diff(): a real directory with no archiveDisplaced is blocked, not conflicted', async () => {
    const f = await fixture()
    const linkPath = join(f.sbx.home, '.claude', 'blockme')
    await mkdir(linkPath, { recursive: true })
    const plan = {
      archiveDir: join(f.sbx.home, '.claude', '.setup-backups', 'x'),
      stateFile: stateFileFor(f.sbx.home),
      groups: [
        {
          section: 'test',
          artifacts: [{ kind: 'symlink' as const, target: '/anywhere', linkPath }],
        },
      ],
    }
    const sections = await diff(plan, { files: {}, keys: {} })
    expect(sections[0]!.changes[0]!.status).toBe('blocked')
  })
})

// ═══ resolver mechanics across a run ════════════════════════════════════════

describe('resolver mechanics across a run', () => {
  test('one resolver spans agents: conflicts from claude-code and opencode reach the same one', async () => {
    const f = await fixture()
    await apply(f, neverResolve(), false, ['claude-code', 'opencode'])
    await writeFile(join(f.sbx.home, CLAUDEMD), 'local claude edit\n')
    await writeFile(join(f.sbx.home, '.config/opencode/AGENTS.md'), 'local opencode edit\n')

    const seen: Conflict[] = []
    await apply(f, scripted(['keep', 'apply'], seen), false, ['claude-code', 'opencode'])
    expect(seen.length).toBe(2)
    expect(seen[0]!.label).toBe(join(f.sbx.home, CLAUDEMD))
    expect(seen[1]!.label).toBe(join(f.sbx.home, '.config/opencode/AGENTS.md'))
    expect(await f.sbx.read(CLAUDEMD)).toBe('local claude edit\n') // kept
    expect(await f.sbx.read('.config/opencode/AGENTS.md')).toBe(INSTRUCTIONS_V1) // applied
  })

  test('forceResolver takes the config side of every conflict, with backups', async () => {
    const f = await fixture()
    await apply(f, neverResolve())
    await writeFile(join(f.sbx.home, CLAUDEMD), 'edited\n')
    await editSettings(f.sbx, (s) => {
      s.autoCompactWindow = 1
    })

    await apply(f, forceResolver)
    expect(await f.sbx.read(CLAUDEMD)).toBe(INSTRUCTIONS_V1)
    expect((await f.sbx.json<Record<string, unknown>>(SETTINGS)).autoCompactWindow).toBe(250000)
    const backups = await backupsUnder(f.sbx, '.claude/.setup-backups')
    expect(backups.some((b) => b.endsWith('CLAUDE.md'))).toBe(true)
    expect(backups.some((b) => b.endsWith('settings.json'))).toBe(true)
  })
})

// ═══ interactive resolver (unit — the picker itself needs a TTY) ════════════

describe('interactiveResolver', () => {
  function fakeConflict(label: string, diffText = 'some diff'): Conflict {
    return {
      status: 'conflict',
      label,
      summary: 'test summary',
      diffText,
      apply: { action: { do: 'run', command: ['true'] } },
      keep: null,
    }
  }

  function askScript(answers: (string | null)[]) {
    const asked: { message: string; choices: Choice[] }[] = []
    const ask = async (message: string, choices: Choice[]) => {
      asked.push({ message, choices })
      return answers.shift() ?? null
    }
    return { ask, asked }
  }

  test('offers show-diff only when there is a diff to show', async () => {
    const { ask, asked } = askScript(['keep', 'keep'])
    const resolve = interactiveResolver(ask)
    await resolve(fakeConflict('a', 'has a diff'))
    await resolve(fakeConflict('b', ''))
    expect(asked[0]!.choices.map((c) => c.value)).toContain('diff')
    expect(asked[1]!.choices.map((c) => c.value)).not.toContain('diff')
  })

  test('keep and apply answer one conflict each', async () => {
    const { ask } = askScript(['keep', 'apply'])
    const resolve = interactiveResolver(ask)
    expect(await resolve(fakeConflict('a'))).toBe('keep')
    expect(await resolve(fakeConflict('b'))).toBe('apply')
  })

  test('show-diff re-asks the same conflict', async () => {
    const { ask, asked } = askScript(['diff', 'apply'])
    const resolve = interactiveResolver(ask)
    expect(await resolve(fakeConflict('a'))).toBe('apply')
    expect(asked.length).toBe(2)
    expect(asked[1]!.message).toBe(asked[0]!.message)
  })

  test('keep-all sticks for every remaining conflict without asking again', async () => {
    const { ask, asked } = askScript(['keep-all'])
    const resolve = interactiveResolver(ask)
    expect(await resolve(fakeConflict('a'))).toBe('keep')
    expect(await resolve(fakeConflict('b'))).toBe('keep')
    expect(await resolve(fakeConflict('c'))).toBe('keep')
    expect(asked.length).toBe(1)
  })

  test('apply-all sticks for every remaining conflict without asking again', async () => {
    const { ask, asked } = askScript(['apply-all'])
    const resolve = interactiveResolver(ask)
    expect(await resolve(fakeConflict('a'))).toBe('apply')
    expect(await resolve(fakeConflict('b'))).toBe('apply')
    expect(asked.length).toBe(1)
  })

  test('cancelling means keep, for this conflict and all remaining ones', async () => {
    const { ask, asked } = askScript([null])
    const resolve = interactiveResolver(ask)
    expect(await resolve(fakeConflict('a'))).toBe('keep')
    expect(await resolve(fakeConflict('b'))).toBe('keep')
    expect(asked.length).toBe(1)
  })
})
