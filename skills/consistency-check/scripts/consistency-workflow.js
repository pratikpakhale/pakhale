export const meta = {
  name: 'consistency-check',
  description:
    'Fan out one agent per consistency dimension to audit a diff against the codebase\'s own conventions, adversarially verify each candidate, then synthesize a ranked report.',
  phases: [
    { title: 'Review', detail: 'one agent per consistency dimension' },
    { title: 'Verify', detail: 'adversarially confirm each candidate finding' },
    { title: 'Synthesize', detail: 'dedup, classify, rank by severity' }
  ]
}

// args: { base: string, changedFiles: string[], repo?: string }
// Gather these inline (git merge-base + git diff --stat) BEFORE invoking, so the
// script only orchestrates. Drop dimensions that don't fit the stack via args.only.
const { base = 'main', changedFiles = [], repo = '.', only = null } = args || {}
const fileList = changedFiles.length
  ? changedFiles.map((f) => `- ${f}`).join('\n')
  : '(none provided — derive from `git diff --name-only ' + base + '...HEAD`)'

const ALL_DIMENSIONS = [
  {
    key: 'code-idioms',
    prompt:
      'Error-handling shape, early-return style, async patterns, import grouping, default vs named exports, type vs interface, and especially HELPERS REINVENTED instead of imported from a central module (e.g. a private formatBytes when one already exists).'
  },
  {
    key: 'ui-visual',
    prompt:
      'Reuse of UI primitives (Button/Dialog/Spinner/SearchBar) vs hand-rolled markup; loader component vs raw animate-spin icon; scrollbar utility vs inline scrollbar-hiding CSS; spacing scale. NOTE: size-N vs h-N w-N are often BOTH dominant — count both, do not flag a dual-convention.'
  },
  {
    key: 'design-tokens',
    prompt:
      'Semantic color tokens (text-primary, bg-muted) vs hardcoded hex/rgb or raw palette; radius/shadow tokens; dark-mode parity. Exclude canvas/chart code that needs literal colors.'
  },
  {
    key: 'i18n-copy',
    prompt:
      'Every user-facing string localized (no hardcoded JSX/aria literals); ALL locale files updated for new keys; key naming/namespacing matches siblings; placeholders and aria-labels localized; an existing translated key reused instead of a near-duplicate.'
  },
  {
    key: 'state-dataflow',
    prompt:
      'Store slice/selector/action conventions; query-key factory & hook conventions; NO useState+useEffect mirroring server/store state (read store directly, update on event); fetch/error parity with sibling services.'
  },
  {
    key: 'architecture',
    prompt:
      'Module in the right layer (pure lib must not import app/store types; wire/API types live with API types, not in a util lib); dependency direction; server vs client boundary; types living next to consumers.'
  },
  {
    key: 'api-types',
    prompt:
      'Request/response shapes match the server contract; boundary casing (snake wire vs camel domain) handled like siblings; structured-result vs thrown-error matches the service pattern; no hidden back-compat shim.'
  },
  {
    key: 'naming-structure',
    prompt:
      'File naming (kebab vs camel), component/hook/util naming, directory placement, export naming, test co-location — compared against sibling files in the same directory.'
  },
  {
    key: 'a11y-semantics',
    prompt:
      'aria-label/role parity with sibling interactive elements; keyboard handlers where siblings have them; modal focus management; semantic elements vs divs.'
  }
]

const DIMENSIONS = only
  ? ALL_DIMENSIONS.filter((d) => only.includes(d.key))
  : ALL_DIMENSIONS

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          deviation: { type: 'string' },
          established: { type: 'string' },
          prevalence: {
            type: 'string',
            description: 'measured counts, e.g. "established 349x, deviation 2x"'
          },
          severity: {
            type: 'string',
            enum: ['correctness', 'behavior', 'i18n', 'a11y', 'naming', 'cosmetic']
          },
          confidence: { type: 'number' }
        },
        required: ['title', 'file', 'deviation', 'established', 'prevalence', 'severity']
      }
    }
  },
  required: ['findings']
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    classification: {
      type: 'string',
      enum: ['genuine', 'false-positive', 'out-of-scope']
    }
  },
  required: ['real', 'reason', 'classification']
}

const RULES = `Repo: ${repo}. Diff base: ${base}.
IN-SCOPE CHANGED FILES (only these):
${fileList}

Hard rules:
- Learn the established convention from the EXISTING (unchanged) codebase and MEASURE prevalence with counts (grep -c both forms). If both forms are widely used, it is an accepted dual-convention — DO NOT flag it.
- Flag only deviations the diff INTRODUCED. Never flag pre-existing untouched code or unrelated concurrent edits.
- Every finding needs file:line, the deviation, the established alternative, and a prevalence count. No count → not a finding.`

log(`Auditing ${changedFiles.length} files across ${DIMENSIONS.length} dimensions vs ${base}`)

const reviewed = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${RULES}\n\nDimension: ${d.key}\nCheck: ${d.prompt}`, {
      label: `review:${d.key}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
      agentType: 'Explore'
    }),
  (review, d) =>
    parallel(
      (review?.findings || []).map((f) => () =>
        agent(
          `Adversarially verify this consistency finding. READ the actual source lines first. Confirm ALL of: (1) introduced by the diff vs ${base}; (2) a genuine deviation and NOT an accepted dual-convention — re-measure prevalence yourself; (3) in scope (a changed file, not pre-existing/concurrent work). Default to real=false when uncertain.\n\nFinding:\n${JSON.stringify(f, null, 2)}`,
          { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        ).then((v) => ({ ...f, dimension: d.key, verdict: v }))
      )
    )
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict?.real && f.verdict?.classification === 'genuine')
const dismissed = all.filter((f) => !(f.verdict?.real && f.verdict?.classification === 'genuine'))

const report = await agent(
  `Write the final consistency report. Dedup by file+line. Rank GENUINE findings by severity (correctness > behavior > i18n/a11y > naming > cosmetic), each as: "[severity] file:line — deviation; codebase uses <established> (<prevalence>). Fix: <one line>". Then list dismissed candidates under "False positives / out of scope" with their one-line reason. Recommend fixes; DO NOT apply them.\n\nGENUINE:\n${JSON.stringify(confirmed, null, 2)}\n\nDISMISSED:\n${JSON.stringify(dismissed.map((d) => ({ file: d.file, line: d.line, title: d.title, verdict: d.verdict })), null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { base, scope: changedFiles.length, confirmed, dismissed, report }
