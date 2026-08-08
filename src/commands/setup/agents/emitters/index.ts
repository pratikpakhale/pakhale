import type { AgentId, Emitter } from '../types'
import { claudeCode } from './claude-code'
import { opencode } from './opencode'

export const emitters: Record<AgentId, Emitter | null> = {
  'claude-code': claudeCode,
  opencode,
  codex: null,
}
