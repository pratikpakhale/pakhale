import pc from 'picocolors'

export const log = {
  agent: (s: string) => console.log(`\n${pc.bold(pc.magenta(`■ ${s}`))}`),
  section: (s: string) => console.log(`\n${pc.bold(pc.cyan(`▸ ${s}`))}`),
  ok: (s: string) => console.log(`  ${pc.green('✓')} ${s}`),
  skip: (s: string) => console.log(`  ${pc.dim('·')} ${pc.dim(s)}`),
  warn: (s: string) => console.log(`  ${pc.yellow('!')} ${s}`),
  fail: (s: string) => console.log(`  ${pc.red('✗')} ${s}`),
  plan: (s: string) => console.log(`  ${pc.yellow('would')} ${s}`),
  info: (s: string) => console.log(`  ${pc.dim(s)}`),
}
