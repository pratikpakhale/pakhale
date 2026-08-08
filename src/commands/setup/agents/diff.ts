import { structuredPatch } from 'diff'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { run, which } from '../../../util/exec'
import { exists, stable } from '../../../util/fs'
import type {
  Artifact,
  FileArtifact,
  InstallArtifact,
  InstallProbe,
  JsonMergeArtifact,
  Plan,
  SymlinkArtifact,
} from './plan'
import { hashContent, hashValue, type SetupState } from './state'

/**
 * Desired state minus actual state. This module reads the machine and returns what would
 * change; it imports nothing that writes, so dry-run purity is structural rather than a
 * `dryRun` flag every function has to remember to honour.
 */

export type Action =
  | { do: 'write-file'; src: string; dest: string; mode?: number; backupTo?: string }
  | { do: 'link'; target: string; linkPath: string; removeExisting?: boolean; archiveTo?: string }
  | { do: 'write-json'; dest: string; value: Record<string, unknown>; backupTo: string }
  | { do: 'run'; command: string[] }

/** What to remember as ours once an action lands, so the next run can tell drift from edits. */
export type StateRecord =
  | { file: string; hash: string }
  | { file: string; keys: Record<string, string> }

/** One way a conflict can be settled: the action to take and what it makes ours. */
interface Outcome {
  action: Action
  record?: StateRecord
  notes?: string[]
}

/**
 * Both sides moved: the config wants one thing, the machine holds another that setup never
 * wrote. Only the executor decides — interactively, or keep-by-default when no one is there.
 * `keep` is a partial application (jsonMerge: their values for the contested keys, the rest
 * applied); `null` means keeping is simply doing nothing.
 */
export interface Conflict {
  status: 'conflict'
  label: string
  summary: string
  diffText: string
  apply: Outcome
  keep: Outcome | null
}

export type Change =
  | { status: 'unchanged'; label: string; record?: StateRecord }
  | { status: 'blocked'; label: string; reason: string }
  | { status: 'pending'; label: string; action: Action; notes?: string[]; record?: StateRecord }
  | Conflict

export interface Section {
  title: string
  changes: Change[]
}

export async function diff(plan: Plan, state: SetupState): Promise<Section[]> {
  const probes = new Probes()
  const sections: Section[] = []

  for (const group of plan.groups) {
    const changes: Change[] = []
    for (const artifact of group.artifacts) {
      changes.push(await changeFor(artifact, plan.archiveDir, state, probes))
    }
    sections.push({ title: group.section, changes })
  }

  return sections
}

function changeFor(
  a: Artifact,
  archiveDir: string,
  state: SetupState,
  probes: Probes,
): Promise<Change> {
  switch (a.kind) {
    case 'file':
      return fileChange(a, archiveDir, state)
    case 'symlink':
      return symlinkChange(a)
    case 'jsonMerge':
      return jsonMergeChange(a, archiveDir, state)
    case 'install':
      return installChange(a, probes)
  }
}

async function fileChange(a: FileArtifact, archiveDir: string, state: SetupState): Promise<Change> {
  const next = await readFile(a.src)
  const current = await readFile(a.dest).catch(() => null)
  const record: StateRecord = { file: a.dest, hash: hashContent(next) }
  if (current?.equals(next)) return { status: 'unchanged', label: a.dest, record }

  const action: Action = { do: 'write-file', src: a.src, dest: a.dest, ...(a.mode && { mode: a.mode }) }

  // Deleting a file setup once wrote is a live edit too — recreate only when resolved to.
  if (current === null && a.dest in state.files) {
    return {
      status: 'conflict',
      label: a.dest,
      summary: 'was deleted on this machine',
      diffText: unified(basename(a.dest), '', next.toString()),
      apply: { action, record },
      keep: null,
    }
  }

  if (current !== null && state.files[a.dest] !== hashContent(current)) {
    return {
      status: 'conflict',
      label: a.dest,
      summary: 'has content setup did not write',
      diffText: unified(basename(a.dest), current.toString(), next.toString()),
      apply: { action: { ...action, backupTo: archiveDir }, record },
      keep: null,
    }
  }

  return { status: 'pending', label: a.dest, action, record }
}

async function symlinkChange(a: SymlinkArtifact): Promise<Change> {
  const label = `${a.linkPath} → ${a.target}`
  const link = { do: 'link', target: a.target, linkPath: a.linkPath } as const

  if (!(await exists(a.linkPath))) return { status: 'pending', label, action: link }

  const st = await lstat(a.linkPath)
  if (st.isSymbolicLink()) {
    if ((await readlink(a.linkPath)) === a.target) return { status: 'unchanged', label }
    return { status: 'pending', label, action: { ...link, removeExisting: true } }
  }

  if (!a.archiveDisplaced) {
    return { status: 'blocked', label, reason: `${a.linkPath} exists as a real directory` }
  }
  const archiveTo = join(a.archiveDisplaced, basename(a.linkPath))
  return {
    status: 'conflict',
    label,
    summary: `a real ${st.isDirectory() ? 'directory' : 'file'} sits where the link goes`,
    diffText: '',
    apply: { action: { ...link, archiveTo } },
    keep: null,
  }
}

async function jsonMergeChange(
  a: JsonMergeArtifact,
  archiveDir: string,
  state: SetupState,
): Promise<Change> {
  const label = basename(a.dest)
  const raw = await readFile(a.dest, 'utf8').catch(() => null)

  let current: Record<string, unknown> = {}
  if (raw !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 'blocked', label, reason: 'not parseable JSON (comments?)' }
    }
    // null and arrays parse fine but cannot be merged into — flattening them would clobber.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'blocked', label, reason: 'not a JSON object' }
    }
    current = parsed as Record<string, unknown>
  }

  const desired = { ...a.managed, ...a.derived }
  const value = { ...current, ...desired }
  const record: StateRecord = {
    file: a.dest,
    keys: Object.fromEntries(Object.keys(desired).map((k) => [k, hashValue(desired[k])])),
  }
  if (stable(current) === stable(value)) return { status: 'unchanged', label, record }

  const notes = Object.keys(value)
    .filter((k) => stable(current[k]) !== stable(value[k]))
    .map((k) => `set ${k}${k in a.derived ? ' (derived)' : ''}`)

  const unmanaged = Object.keys(current).filter((k) => !(k in a.managed) && !(k in a.derived))
  if (unmanaged.length) notes.push(`preserved unmanaged keys: ${unmanaged.join(', ')}`)

  const action: Action = { do: 'write-json', dest: a.dest, value, backupTo: archiveDir }
  const ours = state.keys[a.dest] ?? {}
  // A key we once wrote that is now missing was deleted live — that contests it too.
  const contested = Object.keys(desired).filter((k) => {
    if (stable(current[k]) === stable(desired[k])) return false
    if (k in current) return ours[k] !== hashValue(current[k])
    return k in ours
  })

  if (!contested.length) return { status: 'pending', label, action, notes, record }

  const keepValue = { ...value }
  for (const k of contested) {
    if (k in current) keepValue[k] = current[k]
    else delete keepValue[k]
  }
  const keepRecord: StateRecord = {
    file: a.dest,
    keys: Object.fromEntries(
      Object.entries(record.keys).filter(([k]) => !contested.includes(k)),
    ),
  }
  const keep: Outcome | null =
    stable(keepValue) === stable(current)
      ? null
      : {
          action: { do: 'write-json', dest: a.dest, value: keepValue, backupTo: archiveDir },
          record: keepRecord,
          notes: [`kept your values: ${contested.join(', ')}`],
        }

  return {
    status: 'conflict',
    label,
    summary: `set outside setup: ${contested.join(', ')}`,
    diffText: contested
      .map((k) => unified(k, k in current ? pretty(current[k]) : '', pretty(desired[k])))
      .join('\n'),
    apply: { action, record, notes },
    keep,
  }
}

async function installChange(a: InstallArtifact, probes: Probes): Promise<Change> {
  if (!(await probes.onPath(a.requires))) {
    return { status: 'blocked', label: a.label, reason: `\`${a.requires}\` not on PATH` }
  }
  if (await probes.satisfied(a.probe)) return { status: 'unchanged', label: a.label }
  return { status: 'pending', label: a.label, action: { do: 'run', command: a.command } }
}

function pretty(value: unknown) {
  return `${JSON.stringify(value, null, 2) ?? 'null'}\n`
}

function unified(name: string, before: string, after: string): string {
  const patch = structuredPatch(name, name, before, after)
  const lines = [`── ${name}`]
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    lines.push(...hunk.lines)
  }
  return lines.join('\n')
}

interface SkillLock {
  skills?: Record<string, { source?: string }>
}

/** Memoised machine lookups — `claude plugin list` costs a process spawn, so it runs once. */
class Probes {
  private onPathCache = new Map<string, Promise<boolean>>()
  private jsonCache = new Map<string, Promise<unknown>>()
  private plugins?: Promise<Set<string>>

  onPath(bin: string): Promise<boolean> {
    let hit = this.onPathCache.get(bin)
    if (!hit) this.onPathCache.set(bin, (hit = which(bin)))
    return hit
  }

  async satisfied(probe: InstallProbe): Promise<boolean> {
    switch (probe.kind) {
      case 'claude-plugin':
        return (await this.installedPlugins()).has(probe.id)

      case 'claude-marketplace': {
        const registry = await this.json<Record<string, unknown>>(probe.registryFile)
        return !!registry && probe.name in registry
      }

      case 'skills': {
        if (!probe.names.length) return false
        const skills = (await this.json<SkillLock>(probe.lockFile))?.skills ?? {}

        for (const name of probe.names) {
          if (!(name in skills)) return false
          if (probe.linkDir && !(await exists(join(probe.linkDir, name)))) return false
        }
        return true
      }
    }
  }

  private installedPlugins(): Promise<Set<string>> {
    this.plugins ??= run(['claude', 'plugin', 'list']).then(
      (res) => new Set(res.stdout.match(/[\w.-]+@[\w.-]+/g) ?? []),
    )
    return this.plugins
  }

  private json<T>(file: string): Promise<T | null> {
    let hit = this.jsonCache.get(file)
    if (!hit) {
      hit = readFile(file, 'utf8').then(
        (raw) => {
          try {
            return JSON.parse(raw) as unknown
          } catch {
            return null
          }
        },
        () => null,
      )
      this.jsonCache.set(file, hit)
    }
    return hit as Promise<T | null>
  }
}
