import type { SetupConfig } from './src/commands/setup/agents/types'

export const config: SetupConfig = {
  agents: ['claude-code', 'opencode'],

  marketplaces: {
    'claude-plugins-official': { repo: 'anthropics/claude-plugins-official', builtin: true },
    plannotator: { repo: 'backnotprop/plannotator' },
    impeccable: { repo: 'pbakaus/impeccable' },
  },

  extensions: [
    {
      name: 'context7',
      deliver: {
        'claude-code': {
          via: 'claude-plugin',
          marketplace: 'claude-plugins-official',
          plugin: 'context7',
        },
        opencode: {
          via: 'mcp',
          server: { transport: 'stdio', command: ['npx', '-y', '@upstash/context7-mcp'] },
        },
      },
    },
    {
      name: 'mattpocock-skills',
      deliver: {
        'claude-code': {
          via: 'claude-plugin',
          marketplace: 'claude-plugins-official',
          plugin: 'mattpocock-skills',
        },
        opencode: { via: 'skills', repo: 'mattpocock/skills' },
      },
    },
    {
      name: 'plannotator',
      deliver: {
        'claude-code': { via: 'claude-plugin', marketplace: 'plannotator', plugin: 'plannotator' },
        opencode: { via: 'opencode-plugin', package: '@plannotator/opencode@latest' },
      },
    },
    {
      name: 'impeccable',
      deliver: {
        'claude-code': { via: 'claude-plugin', marketplace: 'impeccable', plugin: 'impeccable' },
        opencode: { via: 'skills', repo: 'pbakaus/impeccable', skills: ['impeccable'] },
      },
    },
    {
      name: 'vercel-agent-skills',
      deliver: {
        all: {
          via: 'skills',
          repo: 'vercel-labs/agent-skills',
          skills: ['vercel-react-best-practices', 'vercel-composition-patterns'],
        },
      },
    },
    {
      name: 'gh-stack',
      deliver: { all: { via: 'skills', repo: 'github/gh-stack', skills: ['gh-stack'] } },
    },
    {
      name: 'sitedrop',
      deliver: { all: { via: 'skills', repo: 'pratikpakhale/sitedrop', skills: ['sitedrop'] } },
    },
  ],

  authoredSkillsDir: 'skills',
  instructionsFile: 'assets/instructions/AGENTS.md',

  claudeCode: {
    statuslineScript: 'assets/statusline/claude-code.sh',
    autoCompactWindow: 250000,
    tui: 'fullscreen',
    cleanupPeriodDays: 14,
    voice: true,
    autoDream: false,
    agentPushNotifications: true,
    permissions: {
      defaultMode: 'auto',
      skipDangerousModePrompt: true,
      skipAutoPrompt: true,
    },
  },
}
