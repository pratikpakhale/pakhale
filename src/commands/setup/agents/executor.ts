import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { run } from '../../../util/exec'
import { backup, ensureDir, writeJson } from '../../../util/fs'
import { log } from '../../../util/log'
import { diff, type Action, type Change, type Section } from './diff'
import type { Plan } from './plan'

/** The one place `dryRun` is consulted: the same diff is either printed or committed. */
export async function runPlan(plan: Plan, dryRun: boolean) {
  const sections = await diff(plan)
  await walk(sections, dryRun ? render : commit)
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
  }
}

async function commit(change: Change) {
  switch (change.status) {
    case 'unchanged':
      return log.skip(`${change.label} (unchanged)`)
    case 'blocked':
      return log.fail(`${change.label} — ${change.reason}, leaving it alone`)
    case 'pending': {
      const { ok, notes } = await perform(change.action)
      if (!ok) return log.fail(`${change.label}: ${notes.join(' ')}`)
      log.ok(change.label)
      for (const note of [...notes, ...(change.notes ?? [])]) log.info(note)
    }
  }
}

async function perform(action: Action): Promise<{ ok: boolean; notes: string[] }> {
  switch (action.do) {
    case 'write-file': {
      const bytes = await readFile(action.src)
      await ensureDir(dirname(action.dest))
      await writeFile(action.dest, bytes, action.mode ? { mode: action.mode } : undefined)
      return { ok: true, notes: [] }
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
