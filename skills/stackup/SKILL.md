---
name: stackup
description: "Stack up a new or under-tooled side project with the current best tooling — package manager, type checker, linter, formatter, dead-code detection, tests, git hooks, and CI — picking one tool per job so nothing conflicts. Use when the user says 'stackup', 'stack up this project', 'set up tooling', 'bootstrap this repo', 'add linting/formatting/hooks', or when starting a new project or finding a repo with no lint/format/typecheck scripts."
metadata:
  author: pratikpakhale
  version: "1.0.0"
---

# Stackup

Stack a project up with the current best tool for each job. **One tool per job** — the failure
mode this skill exists to prevent is two tools owning the same job and fighting each other
(ESLint next to oxlint, Prettier next to oxfmt, black next to ruff, husky next to lefthook).

## Rules

- **Detect, don't ask.** Read the repo first — `package.json`, `pyproject.toml`, lockfiles,
  existing configs. Install only what's missing; never re-pin what's already working.
- **Replace, don't stack.** If a job already has an owner you're replacing, remove the old
  one in the same change — config file, dependency, and scripts. A half-migration is worse
  than either tool alone.
- **Every tool gets a script and a hook.** A linter nobody runs is dead weight. Each tool
  lands in `package.json` scripts (or `pyproject.toml`), then in the hook config, then in CI.
- **Pin the toolchain.** The versions in CI, in hooks, and on the machine must match.
- **Green before you leave.** Run the full check once at the end. Config that has never been
  executed is not configured.

## The stack

| Job | Tool | Never also install |
| --- | --- | --- |
| Runtime, package manager, workspaces | `bun` | npm/yarn/pnpm, `tsx`, `ts-node` |
| Type checking | `typescript@7` (`tsc`) | `tsgo`, `@typescript/native-preview` |
| Linting | `oxlint` + `oxlint-tsgolint` | ESLint, Biome |
| Formatting | `oxfmt` | Prettier, Biome, dprint |
| Unused files/exports/deps | `knip` | depcheck, ts-prune |
| Tests | `bun test` (`vitest` for DOM) | jest, mocha |
| Python everything | `uv` | pip, poetry, pyenv, pipx |
| Python lint + format | `ruff` | black, isort, flake8, autopep8 |
| Python type checking | `ty` | mypy, pyright (see reference) |
| Git hooks | `lefthook` | husky, lint-staged, pre-commit, prek |
| Secret scanning | `gitleaks` | — |
| Toolchain versions | `mise` | nvm, pyenv, asdf |

`typescript@7` is the Go compiler, shipped stable July 2026 — it is the `typescript` package
and the `tsc` binary. `tsgo` and `@typescript/native-preview` were the preview channel and are
obsolete; if you find them in a repo, migrate off.

## Order of operations

Do these in order — later steps depend on scripts the earlier ones create.

1. **Pin the toolchain** — `mise.toml` at the repo root (see [references/hooks-ci.md](references/hooks-ci.md)).
2. **Install per-stack deps and configs** — read the reference for each stack present:

   | Stack | Read |
   | --- | --- |
   | `.ts`, `.js`, Node, Bun | [references/typescript.md](references/typescript.md) |
   | `.tsx`, React, Next.js | [references/react.md](references/react.md) |
   | `.py` | [references/python.md](references/python.md) |

3. **Write the scripts** — every tool reachable by name, plus one aggregate `check`.
4. **Wire hooks and CI** — [references/hooks-ci.md](references/hooks-ci.md).
5. **Run `bun run check` and fix the fallout.** Expect the first run to be noisy on an
   existing codebase: auto-fix what's mechanical, and for the rest either fix it or
   downgrade the specific rule in config with a one-line comment saying why. Do not
   blanket-disable a plugin to get to green.

## Fast vs. whole-project

This split matters everywhere — hooks, CI, and which script you reach for.

- **Per-file, milliseconds** — formatting, non-type-aware lint, secret scan. Runs on staged
  files at `pre-commit`.
- **Whole-program, seconds** — `tsc`, type-aware lint, `ty`, `knip`, tests. These cannot be
  scoped to staged files without being wrong. Runs at `pre-push` and in CI.

Putting `tsc` in `pre-commit` is the most common way to make a team disable hooks entirely.

## Also worth setting up

Raise these with the user rather than installing silently — they are project-shaped, not
universal:

- **Conventional commits** — `commitlint` on the `commit-msg` hook. Cheap, and it's the
  commit convention already in use.
- **`AGENTS.md`** at the repo root with a `CLAUDE.md` symlink to it — the project's own
  instructions for coding agents. Worth writing on day one, while the architecture is a
  decision rather than an archaeology problem.
- **Env var validation** — parse `process.env` once at startup through a schema
  (`arktype` or `zod`) and export the typed object. Only for projects with real config.
- **Publishing** (libraries only) — `tsdown` to build, `publint` and
  `@arethetypeswrong/cli` to verify the published shape.
- **Dependency freshness** — `bun outdated` / `bun audit`, `uv lock --upgrade`. Renovate
  only if the project will outlive your attention span.
- **`.editorconfig`** — one file, stops editors from re-indenting what `oxfmt` formatted.
