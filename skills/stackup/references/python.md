# Python

## uv owns everything

`uv` replaces pip, pip-tools, pipx, poetry, virtualenv, and pyenv. There is no reason to
install any of them alongside it, and no reason to activate a venv by hand — `uv run` does it.

```bash
uv init                      # new project: pyproject.toml + .python-version + .venv
uv add --dev ruff ty pytest
uv run pytest                # runs in the project env, syncing it first if stale
uvx ruff check               # one-off tool run, no project install
```

`uv.lock` is committed. `uv sync --frozen` in CI, so a stale lockfile fails the build instead
of being silently resolved around.

Single-file scripts get inline dependencies (PEP 723) rather than a project — `uv run
script.py` reads the header and builds the env:

```python
# /// script
# requires-python = ">=3.13"
# dependencies = ["httpx"]
# ///
```

## ruff owns lint and format

One tool, one config, no ordering conflicts. black, isort, flake8, pyupgrade, pydocstyle, and
autopep8 are all subsumed — if any are in the project, they're being removed.

```toml
# pyproject.toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "SIM", "RUF", "ASYNC", "S", "PTH"]
ignore = ["E501"]        # the formatter owns line length

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]    # assert is the point in tests
```

`E501` is ignored because `ruff format` already wraps — leaving it on means the linter
complains about lines the formatter deliberately left long (URLs, strings).

## ty for type checking

Astral's checker, Rust, 10–100× faster than mypy and pyright, and it shares uv's and ruff's
config surface.

```bash
uv run ty check
```

It's **beta** as of 2026, targeting 1.0. That's fine for a side project — fast feedback beats
completeness — but know the tradeoff: expect occasional missing features and false positives
on heavy metaprogramming. If ty chokes on a specific project, `basedpyright` is the fallback
(strictly better defaults than pyright, same engine lineage). Swap it in wholesale; don't run
two checkers.

Annotate as you go rather than retrofitting. A checker on unannotated code reports almost
nothing and gives false confidence.

## Scripts

Python has no `package.json` scripts. Either define them in `pyproject.toml` under a task
runner, or — simpler for a side project, and what the hooks call anyway — keep them as plain
commands in the lefthook config and the README:

```bash
uv run ruff check --fix .
uv run ruff format .
uv run ty check
uv run pytest
```

In a mixed JS/Python repo, put these behind `bun run check` too, so one command still covers
the whole repo.
