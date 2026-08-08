import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diff, type Change, type Conflict } from '../src/commands/setup/agents/diff'
import type { Artifact, Plan } from '../src/commands/setup/agents/plan'
import { hashContent, hashValue, type SetupState } from '../src/commands/setup/agents/state'

/**
 * The three-way conflict matrix, pinned cell by cell: (machine state, our last-written
 * record, config's desire) → unchanged / pending / conflict / blocked. Integration tests
 * exercise the flows; this file is the truth table they rely on.
 */

const EMPTY: SetupState = { files: {}, keys: {} }

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'setup-diff-'))
  return {
    root,
    path: (rel: string) => join(root, rel),
    write: async (rel: string, content: string) => {
      const abs = join(root, rel)
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, content)
      return abs
    },
  }
}

async function one(artifact: Artifact, state: SetupState, archiveDir: string): Promise<Change> {
  const plan: Plan = {
    archiveDir,
    stateFile: join(archiveDir, 'unused-state.json'),
    groups: [{ section: 'test', artifacts: [artifact] }],
  }
  const [section] = await diff(plan, state)
  return section!.changes[0]!
}

function asConflict(change: Change): Conflict {
  expect(change.status).toBe('conflict')
  return change as Conflict
}

describe('file artifact three-way matrix', () => {
  test('no destination → pending, never a conflict', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new')

    const c = await one({ kind: 'file', src, dest: t.path('dest') }, EMPTY, t.path('bak'))

    expect(c.status).toBe('pending')
    if (c.status === 'pending') {
      expect(c.action).toEqual({ do: 'write-file', src, dest: t.path('dest') })
      expect(c.record).toEqual({ file: t.path('dest'), hash: hashContent('new') })
    }
  })

  test('destination already matches → unchanged, and the record still seeds state', async () => {
    const t = await scratch()
    const src = await t.write('src', 'same')
    const dest = await t.write('dest', 'same')

    const c = await one({ kind: 'file', src, dest }, EMPTY, t.path('bak'))

    expect(c.status).toBe('unchanged')
    if (c.status === 'unchanged') expect(c.record).toEqual({ file: dest, hash: hashContent('same') })
  })

  test('destination matches what we last wrote → pending silent converge, no backup', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new')
    const dest = await t.write('dest', 'old')
    const state: SetupState = { files: { [dest]: hashContent('old') }, keys: {} }

    const c = await one({ kind: 'file', src, dest }, state, t.path('bak'))

    expect(c.status).toBe('pending')
    if (c.status === 'pending' && c.action.do === 'write-file') {
      expect(c.action.backupTo).toBeUndefined()
    }
  })

  test('destination differs from both sides → conflict; apply backs up, keep is do-nothing', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new\n')
    const dest = await t.write('dest', 'theirs\n')

    const c = asConflict(await one({ kind: 'file', src, dest }, EMPTY, t.path('bak')))

    expect(c.keep).toBeNull()
    expect(c.apply.action).toEqual({ do: 'write-file', src, dest, backupTo: t.path('bak') })
    expect(c.apply.record).toEqual({ file: dest, hash: hashContent('new\n') })
    expect(c.diffText).toContain('-theirs')
    expect(c.diffText).toContain('+new')
  })

  test('a stale record (machine moved on since we wrote) is still a conflict', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new')
    const dest = await t.write('dest', 'edited live')
    const state: SetupState = { files: { [dest]: hashContent('what we once wrote') }, keys: {} }

    expect((await one({ kind: 'file', src, dest }, state, t.path('bak'))).status).toBe('conflict')
  })

  test('a deleted file we once wrote → conflict, not a silent resurrection', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new')
    const dest = t.path('gone')
    const state: SetupState = { files: { [dest]: hashContent('what we wrote') }, keys: {} }

    const c = asConflict(await one({ kind: 'file', src, dest }, state, t.path('bak')))

    expect(c.summary).toBe('was deleted on this machine')
    expect(c.keep).toBeNull()
    expect(c.diffText).toContain('+new')
  })

  test('mode survives onto the conflict apply action', async () => {
    const t = await scratch()
    const src = await t.write('src', 'new')
    const dest = await t.write('dest', 'theirs')

    const c = asConflict(await one({ kind: 'file', src, dest, mode: 0o755 }, EMPTY, t.path('bak')))

    expect(c.apply.action).toMatchObject({ do: 'write-file', mode: 0o755 })
  })
})

describe('jsonMerge artifact three-way matrix', () => {
  const merge = (dest: string, managed: Record<string, unknown>, derived = {}): Artifact => ({
    kind: 'jsonMerge',
    dest,
    managed,
    derived,
  })

  test('an owned key we recorded → pending silent converge when config moves', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ a: 1, extra: 9 }))
    const state: SetupState = { files: {}, keys: { [dest]: { a: hashValue(1) } } }

    const c = await one(merge(dest, { a: 2 }), state, t.path('bak'))

    expect(c.status).toBe('pending')
    if (c.status === 'pending' && c.action.do === 'write-json') {
      expect(c.action.value).toEqual({ a: 2, extra: 9 })
    }
  })

  test('an owned key set by someone else → conflict naming exactly that key', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ a: 1, extra: 9 }))

    const c = asConflict(await one(merge(dest, { a: 2, b: 3 }), EMPTY, t.path('bak')))

    expect(c.summary).toBe('set outside setup: a')
    expect(c.diffText).toContain('── a')
    expect(c.apply.record).toEqual({ file: dest, keys: { a: hashValue(2), b: hashValue(3) } })
  })

  test('keep applies the uncontested additions and records only those as ours', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ a: 1, extra: 9 }))

    const c = asConflict(await one(merge(dest, { a: 2, b: 3 }), EMPTY, t.path('bak')))

    expect(c.keep).not.toBeNull()
    if (c.keep && c.keep.action.do === 'write-json') {
      expect(c.keep.action.value).toEqual({ a: 1, extra: 9, b: 3 })
      expect(c.keep.record).toEqual({ file: dest, keys: { b: hashValue(3) } })
    }
  })

  test('keep is null when the contested key is the only change — keeping must not rewrite', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ a: 1, extra: 9 }))

    const c = asConflict(await one(merge(dest, { a: 2 }), EMPTY, t.path('bak')))

    expect(c.keep).toBeNull()
  })

  test('key order and formatting differences are never drift', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ extra: 9, a: { y: 2, x: 1 } }))

    const c = await one(merge(dest, { a: { x: 1, y: 2 } }), EMPTY, t.path('bak'))

    expect(c.status).toBe('unchanged')
  })

  test('a foreign value that happens to equal the config is agreement, not conflict', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ a: 2 }))

    const c = await one(merge(dest, { a: 2 }), EMPTY, t.path('bak'))

    expect(c.status).toBe('unchanged')
    if (c.status === 'unchanged') expect(c.record).toEqual({ file: dest, keys: { a: hashValue(2) } })
  })

  test('derived keys conflict exactly like managed ones', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ mcpServers: { mine: {} } }))

    const c = asConflict(
      await one(merge(dest, {}, { mcpServers: { context7: {} } }), EMPTY, t.path('bak')),
    )

    expect(c.summary).toBe('set outside setup: mcpServers')
  })

  test('a key we once wrote that was deleted live → contested; keep leaves it deleted', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ extra: 9 }))
    const state: SetupState = { files: {}, keys: { [dest]: { a: hashValue(1) } } }

    const c = asConflict(await one(merge(dest, { a: 2, b: 3 }), state, t.path('bak')))

    expect(c.summary).toBe('set outside setup: a')
    if (c.keep && c.keep.action.do === 'write-json') {
      expect(c.keep.action.value).toEqual({ extra: 9, b: 3 })
      expect(c.keep.record).toEqual({ file: dest, keys: { b: hashValue(3) } })
    } else {
      throw new Error('expected a keep outcome that applies the uncontested addition')
    }
  })

  test('a key never written and still absent is an addition, not a contested deletion', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', JSON.stringify({ extra: 9 }))

    const c = await one(merge(dest, { a: 2 }), EMPTY, t.path('bak'))

    expect(c.status).toBe('pending')
  })

  test('JSON null and JSON arrays block — merging into them would clobber', async () => {
    const t = await scratch()
    const nullDest = await t.write('null.json', 'null')
    const arrayDest = await t.write('array.json', '[1, 2]')

    expect((await one(merge(nullDest, { a: 1 }), EMPTY, t.path('bak'))).status).toBe('blocked')
    expect((await one(merge(arrayDest, { a: 1 }), EMPTY, t.path('bak'))).status).toBe('blocked')
  })

  test('unparseable JSON stays blocked — a conflict prompt must never offer to flatten it', async () => {
    const t = await scratch()
    const dest = await t.write('s.json', '{ // jsonc comment\n "a": 1 }')

    expect((await one(merge(dest, { a: 2 }), EMPTY, t.path('bak'))).status).toBe('blocked')
  })

  test('a missing file is all additions — pending, no conflict', async () => {
    const t = await scratch()

    const c = await one(merge(t.path('none.json'), { a: 1 }), EMPTY, t.path('bak'))

    expect(c.status).toBe('pending')
  })
})

describe('symlink artifact conflicts', () => {
  test('a real directory with an archive destination → conflict, apply archives', async () => {
    const t = await scratch()
    const linkPath = t.path('links/name')
    await mkdir(linkPath, { recursive: true })

    const c = asConflict(
      await one(
        { kind: 'symlink', target: '../t', linkPath, archiveDisplaced: t.path('bak/links') },
        EMPTY,
        t.path('bak'),
      ),
    )

    expect(c.keep).toBeNull()
    expect(c.diffText).toBe('')
    expect(c.apply.action).toMatchObject({ do: 'link', archiveTo: t.path('bak/links/name') })
  })

  test('a real directory with nowhere to archive stays blocked, not a conflict', async () => {
    const t = await scratch()
    const linkPath = t.path('links/name')
    await mkdir(linkPath, { recursive: true })

    const c = await one({ kind: 'symlink', target: '../t', linkPath }, EMPTY, t.path('bak'))

    expect(c.status).toBe('blocked')
  })

  test('a link to the wrong target relinks silently — nothing is lost by re-pointing', async () => {
    const t = await scratch()
    const linkPath = t.path('links/name')
    await mkdir(t.path('links'), { recursive: true })
    await symlink('../elsewhere', linkPath)

    const c = await one({ kind: 'symlink', target: '../t', linkPath }, EMPTY, t.path('bak'))

    expect(c.status).toBe('pending')
    if (c.status === 'pending') expect(c.action).toMatchObject({ do: 'link', removeExisting: true })
  })
})
