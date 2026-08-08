# Python slop

Stack-specific tells. Run these alongside the main hunt, not instead of it.

## Exception handling

`rg -n "except" <changed files>` and check each one the diff added.

- `except Exception:` / bare `except:` — what specific error is expected here? Narrow it.
- `except ... : pass` — silently eats real failures, including `KeyboardInterrupt` on a bare
  clause.
- `try/except` that only logs and re-raises — delete, let it propagate.
- A `try` block wrapping ten lines when one of them raises — shrink it to that line.
- `except` returning a success-shaped value (`return []`, `return None`) so callers can't tell
  failure from empty.

## Defaults & mutation

- Mutable default arguments (`def f(x=[])`, `={}`) — classic shared-state bug.
- A function mutating a list/dict passed in by the caller without saying so in the name.
- Module-level mutable state written at import time.
- `dataclass` field with a mutable default missing `field(default_factory=...)`.

## Redundant checks

- `if x is not None:` on a value the type hint declares non-optional and the caller guarantees.
- `if len(xs) > 0:` — use `if xs:`.
- `if x == True:` / `if x != None:`.
- `hasattr` / `in dict` guards for keys the constructor always sets.
- Re-validating an argument the caller already validated.

## Verbosity

- A `for` loop appending to a list that's a comprehension.
- A comprehension nested three deep, or one spanning multiple lines with a condition —
  that's a loop, write the loop.
- `dict(a=1, b=2)` where a literal reads better; `list()`/`dict()` where `[]`/`{}` do.
- Manual index tracking instead of `enumerate`; parallel indexing instead of `zip`.
- String building with `+` in a loop instead of `join`.
- An `if/else` returning `True`/`False` — return the expression.

## Types & structure

- Type hints on some functions in the file and not others — match the file's convention.
- `Any` / `dict` / bare `list` where a `TypedDict`, `dataclass`, or Pydantic model exists in
  the codebase already.
- `Optional[X]` added everywhere to satisfy the checker rather than because `None` is real.
- A new module-level helper duplicating something in the project's utils package — `rg` the
  behavior, not the name.
- Imports inside a function without a circular-import or lazy-load reason.
- A class with one method and no state — that's a function.

## I/O & resources

- `open()` without a context manager; a file/socket/cursor never closed on the error path.
- Requests in a loop where a batched call or `asyncio.gather` fits.
- ORM query in a loop (N+1) — use `select_related` / `prefetch_related` / a single filtered query.
- `requests` / `httpx` calls with no timeout.
- Blocking I/O inside an `async def`.

## Tests

- A test asserting nothing, or asserting only that the call didn't raise.
- Fixtures added but unused; `mock` patches whose target no longer exists.
- `time.sleep` used to sequence async behavior.
