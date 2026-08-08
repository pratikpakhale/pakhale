import { spawn } from 'node:child_process'

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

export function run(cmd: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd
    const proc = spawn(bin!, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', () => resolve({ ok: false, stdout, stderr }))
    proc.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
  })
}

export async function which(bin: string) {
  return (await run(['sh', '-c', `command -v ${bin}`])).ok
}
