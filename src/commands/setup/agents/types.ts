import type { Plan } from './plan'

export type AgentId = 'claude-code' | 'codex' | 'opencode'

/** Agent-neutral MCP declaration — each emitter translates it into that agent's schema. */
export type McpServer =
  | { transport: 'stdio'; command: string[]; env?: Record<string, string> }
  | { transport: 'http'; url: string; headers?: Record<string, string> }

export interface Marketplace {
  repo: string
  /** Ships with Claude Code — skip `marketplace add` and omit from extraKnownMarketplaces. */
  builtin?: boolean
}

/** Portable: `npx skills add`, works on every agent that reads SKILL.md. */
export interface SkillsDelivery {
  via: 'skills'
  repo: string
  /** Omit to install every skill the repo exposes. */
  skills?: string[]
}

/** Claude Code only: a marketplace plugin, installed and updated by `claude plugin`. */
export interface ClaudePluginDelivery {
  via: 'claude-plugin'
  marketplace: string
  plugin: string
}

/** opencode only: an npm module listed under the `plugin` key of its config. */
export interface OpencodePluginDelivery {
  via: 'opencode-plugin'
  package: string
}

/** Portable: an MCP server, keyed in each agent's config under the extension's name. */
export interface McpDelivery {
  via: 'mcp'
  server: McpServer
}

export type Delivery = SkillsDelivery | ClaudePluginDelivery | OpencodePluginDelivery | McpDelivery

/**
 * Why an extension reaches an agent by no route at all. Both are explicit on purpose — the
 * difference between "upstream ships nothing" and "I chose not to" is worth keeping.
 */
export type NoDelivery = 'unsupported' | 'skip'

/**
 * One capability I want my agents to have — a plugin, a skill set, an MCP server. Named for
 * what it *is* to the agent, not for how any one agent happens to package it.
 */
export interface Extension {
  name: string
  /**
   * `all` covers every agent in `config.agents`; a per-agent key overrides it. Every
   * agent must resolve to a delivery or an explicit `NoDelivery` — silence is an error,
   * so adding an agent surfaces every hole instead of quietly under-installing.
   */
  deliver: { all?: Delivery } & Partial<Record<AgentId, Delivery | NoDelivery>>
}

export interface HookCommand {
  type: 'command'
  command: string
  timeout?: number
}

export interface HookMatcher {
  matcher?: string
  hooks: HookCommand[]
}

export interface ClaudeCodePermissions {
  defaultMode?: string
  skipDangerousModePrompt?: boolean
  skipAutoPrompt?: boolean
  deny?: string[]
}

export interface ClaudeCodeConfig {
  statuslineScript: string
  effort?: 'low' | 'medium' | 'high'
  autoCompactWindow?: number
  tui?: string
  cleanupPeriodDays?: number
  voice?: boolean
  autoDream?: boolean
  agentPushNotifications?: boolean
  permissions?: ClaudeCodePermissions
  hooks?: Record<string, HookMatcher[]>
  commandsDir?: string
}

export interface SetupConfig {
  agents: AgentId[]
  /** Claude Code plugin registries, referenced by name from `claude-plugin` deliveries. */
  marketplaces: Record<string, Marketplace>
  extensions: Extension[]
  authoredSkillsDir: string
  instructionsFile: string
  claudeCode: ClaudeCodeConfig
}

export interface EmitContext {
  home: string
  repoRoot: string
  config: SetupConfig
}

/**
 * An agent is a description, not a procedure: where it lives and what it should look like.
 * `applyAgents` owns detection and execution, so every agent gets identical treatment.
 */
export interface Emitter {
  id: AgentId
  /** Relative to home; its absence means the agent is not installed on this machine. */
  configDir: string
  buildPlan(ctx: EmitContext): Promise<Plan>
}
