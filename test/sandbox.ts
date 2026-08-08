import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

export interface Sandbox {
  home: string
  root: string
  calls(): Promise<string[]>
  tree(sub?: string): Promise<string[]>
  read(rel: string): Promise<string>
  json<T>(rel: string): Promise<T>
}

const ORIGINAL_PATH = process.env.PATH ?? ''

const CLAUDE_SHIM = `#!/bin/sh
echo "claude $*" >> "$SANDBOX_CALLS"
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  cat "$SANDBOX_HOME/.installed-plugins" 2>/dev/null
fi
if [ "$1" = "plugin" ] && [ "$2" = "install" ]; then
  echo "  ❯ $3" >> "$SANDBOX_HOME/.installed-plugins"
fi
exit 0
`

const NPX_SHIM = `#!/bin/sh
echo "npx $*" >> "$SANDBOX_CALLS"
exit 0
`

export async function makeSandbox(
  opts: { withClaudeDir?: boolean; withOpencodeDir?: boolean } = {},
): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'setup-sbx-'))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  await mkdir(home, { recursive: true })
  await mkdir(bin, { recursive: true })

  if (opts.withClaudeDir !== false) await mkdir(join(home, '.claude'), { recursive: true })
  if (opts.withOpencodeDir !== false)
    await mkdir(join(home, '.config/opencode'), { recursive: true })

  const calls = join(root, 'calls.log')
  await writeFile(calls, '')
  await writeFile(join(bin, 'claude'), CLAUDE_SHIM, { mode: 0o755 })
  await writeFile(join(bin, 'npx'), NPX_SHIM, { mode: 0o755 })

  process.env.SANDBOX_CALLS = calls
  process.env.SANDBOX_HOME = home
  process.env.PATH = `${bin}:${ORIGINAL_PATH}`

  return {
    home,
    root,
    calls: async () =>
      (await readFile(calls, 'utf8')).split('\n').filter(Boolean),
    tree: (sub = '') => walk(join(home, sub), join(home, sub)),
    read: (rel) => readFile(join(home, rel), 'utf8'),
    json: async <T,>(rel: string) => JSON.parse(await readFile(join(home, rel), 'utf8')) as T,
  }
}

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = join(dir, e.name)
    const rel = relative(base, abs)
    const st = await lstat(abs)
    if (st.isSymbolicLink()) out.push(`${rel} -> ${await readlink(abs)}`)
    else if (st.isDirectory()) out.push(`${rel}/`, ...(await walk(abs, base)))
    else out.push(rel)
  }
  return out
}
