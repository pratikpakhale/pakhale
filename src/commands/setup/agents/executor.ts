import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { run } from '../../../util/exec'
import { backup, ensureDir, stable, writeJson } from '../../../util/fs'
import { log } from '../../../util/log'
import { diff, type Action, type Change, type Section, type StateRecord } from './diff'
import type { Plan } from './plan'
import type { Resolver } from './resolve'
import { loadState, saveState, type SetupState } from './state'

/** The one place `dryRun` is consulted: the same diff is either printed or committed. */
export async function runPlan(plan: Plan, dryRun: boolean, resolve: Resolver) {
  const state = await loadState(plan.stateFile)
  const before = stable(state)
  const sections = await diff(plan, state)

  await walk(sections, dryRun ? render : (change) => commit(change, state, resolve))
  if (!dryRun && stable(state) !== before) await saveState(plan.stateFile, state)
}

async function walk(sections: Section[], handle: (change: Change) => void | Promise<void>) {
  for (const { title, changes } of sections) {
    log.section(title)
    for (const change of changes) await handle(change)
  }
}

function render(change: Change) {
  switch (change.status) {
    case 'unchanged':
      return log.skip(`${change.label} (unchanged)`)
    case 'blocked':
      return log.warn(`${change.label} — ${change.reason}, leaving it alone`)
    case 'pending':
      log.plan(phrase(change.action))
      for (const note of change.notes ?? []) log.info(note)
      return
    case 'conflict':
      log.warn(`conflict: ${change.label} — ${change.summary}`)
      log.info('will ask keep / use config / show diff (piped runs keep; --force uses config)')
  }
}

async function commit(change: Change, state: SetupState, resolve: Resolver) {
  switch (change.status) {
    case 'unchanged':
      record(state, change.record)
      return log.skip(`${change.label} (unchanged)`)
    case 'blocked':
      return log.fail(`${change.label} — ${change.reason}, leaving it alone`)
    case 'pending': {
      const { ok, notes } = await perform(change.action)
      if (!ok) return log.fail(`${change.label}: ${notes.join(' ')}`)
      record(state, change.record)
      log.ok(change.label)
      for (const note of [...notes, ...(change.notes ?? [])]) log.info(note)
      return
    }
    case 'conflict': {
      const outcome = (await resolve(change)) === 'apply' ? change.apply : change.keep
      if (!outcome) {
        return log.warn(
          `${change.label} — ${change.summary}; kept as-is (resolve interactively or with --force)`,
        )
      }
      const { ok, notes } = await perform(outcome.action)
      if (!ok) return log.fail(`${change.label}: ${notes.join(' ')}`)
      record(state, outcome.record)
      log.ok(change.label)
      for (const note of [...notes, ...(outcome.notes ?? [])]) log.info(note)
    }
  }
}

function record(state: SetupState, entry?: StateRecord) {
  if (!entry) return
  if ('hash' in entry) state.files[entry.file] = entry.hash
  else state.keys[entry.file] = { ...state.keys[entry.file], ...entry.keys }
}

async function perform(action: Action): Promise<{ ok: boolean; notes: string[] }> {
  switch (action.do) {
    case 'write-file': {
      const notes: string[] = []
      if (action.backupTo) {
        const bak = await backup(action.dest, action.backupTo)
        if (bak) notes.push(`backed up → ${bak}`)
      }
      const bytes = await readFile(action.src)
      await ensureDir(dirname(action.dest))
      await writeFile(action.dest, bytes, action.mode ? { mode: action.mode } : undefined)
      return { ok: true, notes }
    }

    case 'link': {
      const notes: string[] = []
      if (action.archiveTo) {
        await ensureDir(dirname(action.archiveTo))
        await rename(action.linkPath, action.archiveTo)
        notes.push(`archived → ${action.archiveTo}`)
      } else if (action.removeExisting) {
        await rm(action.linkPath, { recursive: true, force: true })
      }
      await ensureDir(dirname(action.linkPath))
      await symlink(action.target, action.linkPath)
      return { ok: true, notes }
    }

    case 'write-json': {
      const bak = await backup(action.dest, action.backupTo)
      await writeJson(action.dest, action.value)
      return { ok: true, notes: bak ? [`backed up → ${bak}`] : [] }
    }

    case 'run': {
      const res = await run(action.command)
      const output = res.stdout + res.stderr
      if (res.ok) return { ok: true, notes: [] }
      if (/already/i.test(output)) return { ok: true, notes: ['already present'] }
      return { ok: false, notes: [output.trim().split('\n').slice(-1)[0] ?? 'failed'] }
    }
  }
}

function phrase(action: Action): string {
  switch (action.do) {
    case 'write-file':
      return `write ${action.dest}`
    case 'link':
      if (action.archiveTo) return `archive ${action.linkPath} → ${action.archiveTo}, then link`
      return `${action.removeExisting ? 'relink' : 'link'} ${action.linkPath} → ${action.target}`
    case 'write-json':
      return `write ${action.dest}`
    case 'run':
      return action.command.join(' ')
  }
}
