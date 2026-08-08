import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stable, writeJson } from '../../../util/fs'

/**
 * What setup last wrote, per destination — the dpkg-conffile trick. A machine that differs
 * from the config is only a *conflict* when it also differs from this record; otherwise one
 * side is simply behind and converging silently is correct. Files are hashed whole;
 * jsonMerge destinations are hashed per managed key, because other programs legitimately
 * rewrite the rest of those files all the time.
 */
export interface SetupState {
  files: Record<string, string>
  keys: Record<string, Record<string, string>>
}

/** Machine-local bookkeeping, never a source of truth — do not sync or vendor it. */
export function stateFileFor(home: string) {
  return join(home, '.agents', '.setup-state.json')
}

export function hashContent(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex')
}

export function hashValue(value: unknown) {
  return hashContent(stable(value))
}

export async function loadState(file: string): Promise<SetupState> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SetupState>
    return { files: parsed.files ?? {}, keys: parsed.keys ?? {} }
  } catch {
    return { files: {}, keys: {} }
  }
}

export async function saveState(file: string, state: SetupState) {
  await writeJson(file, state)
}
