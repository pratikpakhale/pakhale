# Hooks, CI, and toolchain pinning

## Toolchain versions — mise

One file pins every language runtime, so the machine, the hooks, and CI agree. This replaces
nvm, pyenv, and asdf, and it handles a polyglot repo that `.nvmrc` alone can't.

```toml
# mise.toml
[tools]
bun = "1.3"
python = "3.13"
```

`mise install` on a fresh clone. CI uses `jdx/mise-action`, so the pin is honoured there too
rather than being re-declared in the workflow.

## Git hooks — lefthook

A single Go binary, one YAML file, parallel execution, and no dependency on Node or Python —
which is what makes it the right pick for a repo with both. It replaces husky **and**
lint-staged; `pre-commit`/`prek` cover the same ground but drag in the Python toolchain and
run sequentially. Don't install two hook managers — they fight over the same
`.git/hooks` entries and the loser silently stops running.

```bash
bun add -D lefthook && bunx lefthook install
```

`lefthook install` writes `.git/hooks`. It has to be re-run on a fresh clone — put it in a
`prepare` script so `bun install` does it.

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  jobs:
    - name: format
      glob: "*.{ts,tsx,js,jsx,json,css,md}"
      run: bunx oxfmt {staged_files}
      stage_fixed: true

    - name: lint
      glob: "*.{ts,tsx,js,jsx}"
      run: bunx oxlint --fix {staged_files}
      stage_fixed: true

    - name: python
      glob: "*.py"
      run: uv run ruff check --fix {staged_files} && uv run ruff format {staged_files}
      stage_fixed: true

    - name: secrets
      run: gitleaks git --staged --redact --no-banner

pre-push:
  parallel: true
  jobs:
    - name: check
      run: bun run check
    - name: python
      run: uv run ty check && uv run pytest
    - name: test
      run: bun test

commit-msg:
  jobs:
    - name: conventional
      run: bunx commitlint --edit {1}
```

Why the split: `pre-commit` holds only per-file work that finishes in milliseconds, and
`stage_fixed: true` re-stages what the fixers rewrote so the commit contains the formatted
version. `tsc`, type-aware lint, `ty`, `knip`, and tests need the whole program — they can't
be scoped to staged files without being wrong, so they run at `pre-push`.

A `pre-commit` hook that takes ten seconds is a hook that gets bypassed with `--no-verify`
within a week. Keep it fast and the rest at push.

## Secret scanning — gitleaks

`brew install gitleaks`. The `git --staged` invocation above scans only what's being
committed, so it costs nothing per commit. This is the one hook worth keeping even in a repo
where you skip everything else — a leaked key in git history is not fixable by a later commit.

Add a `.gitleaksignore` for the false positives (test fixtures, example configs) rather than
loosening the rules.

## Conventional commits — commitlint

```bash
bun add -D @commitlint/cli @commitlint/config-conventional
```

```js
// commitlint.config.js
export default { extends: ['@commitlint/config-conventional'] }
```

Optional, and worth it on anything that will get a changelog. It's the one hook that rejects
rather than fixes, so it's also the most annoying — skip it on scratch repos.

## CI — run the same commands

The workflow must not invent its own commands. It runs what the hooks run, so passing locally
means passing in CI.

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }        # gitleaks needs history
      - uses: jdx/mise-action@v3
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun test
      - run: uv sync --frozen && uv run ty check && uv run pytest
      - run: gitleaks git --redact --no-banner
```

`--frozen-lockfile` and `uv sync --frozen` are what make CI meaningful: an out-of-date
lockfile fails the build instead of being quietly resolved around, which is exactly the
drift that makes "works on my machine" happen.

Drop the `uv` line for a JS-only repo and the `bun` lines for a Python-only one — but keep
both `check` and the lockfile flags.
