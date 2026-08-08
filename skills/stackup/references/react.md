# React

Everything in [typescript.md](typescript.md) applies first. This adds what's React-specific.

## Linting — no ESLint needed

oxlint's `react` plugin covers `eslint-plugin-react`, `eslint-plugin-react-hooks`,
`eslint-plugin-react-refresh`, **and** the React Compiler rules. `jsx-a11y` is a separate
plugin. So a React project needs no ESLint and no `eslint-plugin-*` dependencies at all —
if you find them, they're being replaced, not kept alongside.

```json
{
  "plugins": ["typescript", "unicorn", "oxc", "import", "promise", "react", "jsx-a11y"],
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" }
}
```

Note that listing `plugins` overwrites the defaults — `typescript`, `unicorn`, and `oxc` are
in the list because they'd otherwise be dropped.

## The three dev tools

All three are development-only and none of them belong in a production bundle. They do
different jobs; installing one is not a reason to skip the others.

### react-doctor — static audit, runs in CI

Scans the codebase and returns a health score with file-level diagnostics across ~60 rules:
state and effects, performance, architecture, security, bundle size, accessibility, dead code.
It's a CLI, so it's the only one of the three that can gate a build.

```bash
bunx react-doctor@latest
```

Wire it as a `doctor` script. Treat the score as a trend line, not a gate — it moves when
rules change upstream. If you do gate on it, gate on "no new *errors*", never on the number.

### react-scan — render performance, runs in the browser

Highlights components that re-render and why, live in the running app. This is the tool for
"the page feels slow" — it shows you the actual offending component instead of you guessing
at `memo` placement.

```ts
// entry file, before React renders
if (import.meta.env.DEV) import('react-scan').then(({ scan }) => scan())
```

Import it **before** React, or it can't instrument the renderer. There's also
`bunx react-scan@latest <url>` to point it at a running app without touching the code.

### react-grab — hand UI to the agent

Hover an element in the running app, `⌘C`, and the component stack with source locations
(`<a> in LoginForm (at components/login-form.tsx:46:19)`) lands on the clipboard, ready to
paste into an agent prompt. It's the fastest way to answer "which file is this button in".

```bash
bunx grab@latest init
```

The init command wires it for the detected framework. Whatever it writes, verify the setup is
dev-guarded — `import.meta.env.DEV` for Vite, `process.env.NODE_ENV === "development"` for
Next.js.

## React Compiler

If the project is on the compiler, oxlint's react plugin already reports compiler rule
violations, so you don't need a separate healthcheck pass in CI. If it isn't on the compiler,
enabling it is usually a better performance investment than hand-placed `memo`/`useMemo` —
raise it, but don't turn it on unasked; it changes runtime behavior.

## Testing

Component tests need a DOM, which `bun test` can provide via `happy-dom`. That's enough for
render-and-assert. Use `vitest` with browser mode instead when the tests need real layout,
real events, or visual assertions — that's the one case where the extra dependency pays.
