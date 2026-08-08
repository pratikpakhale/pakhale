#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { commands } from './commands'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [name, ...rest] = process.argv.slice(2)

async function version(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  return pkg.version
}

function usage() {
  console.log(`Usage: pakhale <command> [options]\n\nCommands:`)
  for (const c of Object.values(commands)) console.log(`  ${c.name.padEnd(10)} ${c.describe}`)
  console.log(`\nOptions:\n  -h, --help     show this help\n  -v, --version  show version`)
}

if (!name || name === '--help' || name === '-h') {
  usage()
  process.exit(0)
}

if (name === '--version' || name === '-v') {
  console.log(await version())
  process.exit(0)
}

const command = commands[name]
if (!command) {
  console.error(pc.red(`unknown command: ${name}\n`))
  usage()
  process.exit(1)
}

try {
  process.exit(await command.run(rest, packageRoot))
} catch (err) {
  console.error(pc.red(err instanceof Error ? err.message : String(err)))
  process.exit(1)
}
