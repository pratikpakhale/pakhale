# TypeScript / JavaScript

## Install

```bash
bun add -D typescript oxlint oxlint-tsgolint oxfmt knip
```

`knip` ships a `knip-bun` binary — use that one in a Bun project, it resolves Bun's module
graph correctly.

## `tsconfig.json`

TypeScript 7 changed the defaults. `strict` is now **on** by default, and `types` defaults to
`[]` instead of hoovering up every `@types` package in `node_modules` — list what you actually
need. Gone entirely: `target: es5`, AMD/UMD/SystemJS modules, `baseUrl`, classic module
resolution. If a repo's config uses any of them, it needs migrating, not copying.

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "types": ["bun"],
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "erasableSyntaxOnly": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`noUncheckedIndexedAccess` is the one strict-adjacent flag `strict` doesn't turn on and the
one that catches the most real bugs. `erasableSyntaxOnly` keeps the code runnable by anything
that only strips types — no `enum`, no parameter properties, no namespaces.

## `.oxlintrc.json`

`plugins` **overwrites** the default set, so list every plugin you want, including the ones
that were on by default (`typescript`, `unicorn`, `oxc`).

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "import", "promise", "node"],
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
  "options": { "typeAware": true },
  "ignorePatterns": ["dist", "node_modules"]
}
```

Type-aware linting is stable and covers 59 of typescript-eslint's 61 type-aware rules. It
needs `oxlint-tsgolint` installed, and it is the slow path — see the fast/whole-project split
in `SKILL.md`. On a very large codebase watch memory; if it thrashes, keep `typeAware` out of
the config and pass `--type-aware` only in the CI script.

## Formatting

`oxfmt` is Prettier-compatible in output and needs no config for the default style. It is
beta as of 2026, and it still delegates Markdown to Prettier internally — fine, but if a
project is mostly Markdown, or `oxfmt` mangles something, Prettier alone is the fallback.
**Never run both** — pick one and delete the other's config.

## Scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "knip": "knip-bun",
    "test": "bun test",
    "check": "bun run typecheck && bun run lint && bun run format:check && bun run knip"
  }
}
```

`check` is the single command hooks, CI, and the user all run. Keep it that way — the moment
CI runs something the local `check` doesn't, the hooks stop being trustworthy.

## Testing

`bun test` is the default: no dependency, no config, Jest-compatible API, and it runs
TypeScript directly. Reach for `vitest` only when you need what Bun's runner doesn't have —
component/DOM testing, browser mode, or a rich mocking surface. Adding `vitest` for a project
of pure logic tests is a dependency you'll maintain for nothing.

## Libraries

Only when the package is published:

```bash
bun add -D tsdown publint @arethetypeswrong/cli
```

`tsdown` builds and emits declarations; `publint` checks the package manifest, and
`attw --pack .` checks that the types actually resolve for consumers under every module
resolution mode. Both belong in the `check` script for a library — a broken `exports` map is
invisible until someone else installs it.

## Knip

The first `knip` run on an existing codebase reports a lot, and much of it is intentional
public API rather than dead code. Triage it: real removals go, deliberate entry points go in
`knip.json` under `entry`/`ignore` — with the reason in a comment. Don't wire it into a
blocking hook until it reports clean once.
