import { mkdir, lstat, readFile, writeFile, copyFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export async function exists(p: string) {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true })
}

export async function backup(path: string, archiveDir: string) {
  if (!(await exists(path))) return null
  const dest = join(archiveDir, basename(path))
  await ensureDir(archiveDir)
  await copyFile(path, dest)
  return dest
}

export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}

export async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path))
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
