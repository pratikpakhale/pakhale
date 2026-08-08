# TypeScript / Node slop

Stack-specific tells. Run these alongside the main hunt, not instead of it.

## Escape hatches

`rg -n ": any|as any|as unknown as|@ts-ignore|@ts-expect-error|!\." <changed files>`

Every hit is a claim the author couldn't prove. For each: is the real type knowable here?
Usually yes — a generic, a narrowing check, or a proper return type on the function upstream.
`as any` on a test mock is fine; `as any` to make a call site compile is a bug in waiting.

Non-null `!` on something the diff didn't just check is the same category — it's an assertion
that the next reader will trust and the runtime won't.

## Type slop

- A type declared and used once, inline-able at its single use site.
- A generic parameter appearing exactly once in the signature — it isn't doing anything.
- `interface` vs `type` inconsistent with the surrounding file.
- A hand-written type duplicating something already derived elsewhere — prefer
  `z.infer`, `ReturnType`, `Awaited`, `typeof`, or the ORM's generated types over a
  parallel definition that will drift.
- Optional fields (`x?: T`) everywhere because the shape wasn't decided — each one forces a
  guard at every consumer.
- A union whose members are never discriminated at any call site.
- `Record<string, any>` where the keys are actually known.

## Redundant narrowing

- `if (x)` where `x` is already `NonNullable` per its type.
- `typeof x === 'string'` on a `string`.
- `?.` chained on a value the line above proved non-null.
- `x ?? default` where `x`'s type excludes null/undefined.
- A type guard function that duplicates a check the caller just performed.

## Async

- `await` inside a `for` loop over independent items — `Promise.all` (or a bounded pool).
- A promise created and never awaited; a floating `.then()` with no `.catch`.
- `try/catch` wrapping an entire function body to log-and-rethrow.
- `catch (e)` that swallows, or that returns a success-shaped value on failure.
- An `async` function with no `await` in it.
- No timeout / no abort signal on outbound `fetch`.
- Sequential DB round-trips in a loop (N+1) where one query with an `IN` clause works.

## Structure & modules

- A barrel `index.ts` added purely to re-export one module.
- A `utils.ts` / `helpers.ts` grab-bag created for a single function — put it next to its use.
- A constant defined in the new file that already exists in the shared constants module —
  `rg` the literal value, not just the name.
- Env vars read via `process.env.X` inline when the project has a validated config module.
- A new dependency doing what the stdlib or an existing dep already does. Check `package.json`
  before accepting any new import.

## Validation

- A Zod/Valibot schema and a TS interface maintained side by side — infer one from the other.
- External input (request body, query params, webhook payload, JSON file) typed by assertion
  instead of parsed.
- `.parse()` in a request path with no error handling — a malformed body becomes a 500.
