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

/**
 * Desired state minus actual state. This module reads the machine and returns what would
 * change; it imports nothing that writes, so dry-run purity is structural rather than a
 * `dryRun` flag every function has to remember to honour.
 */

export type Action =
  | { do: 'write-file'; src: string; dest: string; mode?: number }
  | { do: 'link'; target: string; linkPath: string; removeExisting?: boolean; archiveTo?: string }
  | { do: 'write-json'; dest: string; value: Record<string, unknown>; backupTo: string }
  | { do: 'run'; command: string[] }

export type Change =
  | { status: 'unchanged'; label: string }
  | { status: 'blocked'; label: string; reason: string }
  | { status: 'pending'; label: string; action: Action; notes?: string[] }

export interface Section {
  title: string
  changes: Change[]
}

export async function diff(plan: Plan): Promise<Section[]> {
  const probes = new Probes()
  const sections: Section[] = []

  for (const group of plan.groups) {
    const changes: Change[] = []
    for (const artifact of group.artifacts) {
      changes.push(await changeFor(artifact, plan.archiveDir, probes))
    }
    sections.push({ title: group.section, changes })
  }

  return sections
}

function changeFor(a: Artifact, archiveDir: string, probes: Probes): Promise<Change> {
  switch (a.kind) {
    case 'file':
      return fileChange(a)
    case 'symlink':
      return symlinkChange(a)
    case 'jsonMerge':
      return jsonMergeChange(a, archiveDir)
    case 'install':
      return installChange(a, probes)
  }
}

async function fileChange(a: FileArtifact): Promise<Change> {
  const next = await readFile(a.src)
  const current = await readFile(a.dest).catch(() => null)
  if (current?.equals(next)) return { status: 'unchanged', label: a.dest }

  return {
    status: 'pending',
    label: a.dest,
    action: { do: 'write-file', src: a.src, dest: a.dest, ...(a.mode && { mode: a.mode }) },
  }
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
  return { status: 'pending', label, action: { ...link, archiveTo } }
}

async function jsonMergeChange(a: JsonMergeArtifact, archiveDir: string): Promise<Change> {
  const label = basename(a.dest)
  const raw = await readFile(a.dest, 'utf8').catch(() => null)

  let current: Record<string, unknown> = {}
  if (raw !== null) {
    try {
      current = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { status: 'blocked', label, reason: 'not parseable JSON (comments?)' }
    }
  }

  const value = { ...current, ...a.managed, ...a.derived }
  if (stable(current) === stable(value)) return { status: 'unchanged', label }

  const notes = Object.keys(value)
    .filter((k) => stable(current[k]) !== stable(value[k]))
    .map((k) => `set ${k}${k in a.derived ? ' (derived)' : ''}`)

  const unmanaged = Object.keys(current).filter((k) => !(k in a.managed) && !(k in a.derived))
  if (unmanaged.length) notes.push(`preserved unmanaged keys: ${unmanaged.join(', ')}`)

  return {
    status: 'pending',
    label,
    action: { do: 'write-json', dest: a.dest, value, backupTo: archiveDir },
    notes,
  }
}

async function installChange(a: InstallArtifact, probes: Probes): Promise<Change> {
  if (!(await probes.onPath(a.requires))) {
    return { status: 'blocked', label: a.label, reason: `\`${a.requires}\` not on PATH` }
  }
  if (await probes.satisfied(a.probe)) return { status: 'unchanged', label: a.label }
  return { status: 'pending', label: a.label, action: { do: 'run', command: a.command } }
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
