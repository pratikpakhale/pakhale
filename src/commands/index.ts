import { setup } from './setup'

export interface Command {
  name: string
  describe: string
  run(argv: string[], packageRoot: string): Promise<number>
}

export const commands: Record<string, Command> = {
  [setup.name]: setup,
}
