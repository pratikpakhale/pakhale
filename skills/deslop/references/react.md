# React / Next.js slop

Stack-specific tells. Run these alongside the main hunt, not instead of it.

## Effects

`rg -n "useEffect" <changed files>` and triage every one the diff added. Reference:
https://react.dev/learn/you-might-not-need-an-effect

| The effect… | Verdict |
| --- | --- |
| sets state derived from props/state already in scope | delete — compute during render |
| runs in response to a click/submit/change | delete — move into the event handler |
| resets state when a prop changes | delete — pass a `key` instead |
| fetches, then sets state, with no cleanup | keep but fix — needs abort/ignore flag, or move to the framework's data layer |
| subscribes to the DOM, a store, a socket, an observer | keep — this is what effects are for |
| has an empty dep array but reads props/state | bug — stale closure |

Also: an effect whose dep array was hand-trimmed to silence the lint rule is a bug, not a
style choice. And every subscription/listener/interval/observer needs a cleanup return —
missing one is a leak.

## Memo theater

`useMemo` / `useCallback` / `React.memo` added around cheap work is noise that costs more
than it saves. Tell: memoizing a string concat, an object literal of primitives, a `.filter`
over a handful of items.

Ask: what re-render does this actually prevent? Nothing measurable → remove it.

The inverse is a real finding: a memoized child that re-renders anyway because a parent
passes a fresh object/array/arrow prop each render. Fix the prop, not the child.

## Client/server boundary (Next.js App Router)

- `'use client'` added to a component that renders no interactivity, no hooks, no browser
  API — remove it and let it stay a server component.
- `'use client'` on a high-level layout or page, dragging its whole subtree client-side.
  Push the directive down to the leaf that actually needs it.
- Server-only imports (`fs`, DB client, secret env) reachable from a client component —
  that's a leak and a build error waiting to happen.
- `useEffect` + `fetch` for data a server component or route handler could fetch directly.
- Server Actions: no auth check, no input validation, or returning raw DB rows to the client.
- Data fetched but never revalidated/invalidated after a mutating action.

## State

- State duplicating a prop (`useState(props.x)`) that then drifts — derive it instead.
- Multiple `useState` calls always set together — one object or reducer.
- State that's never read, or only read by the effect that set it.
- A ref used where state is required (value drives render) or state where a ref would do
  (value never rendered).
- Context provider added for a value consumed by one component two levels down.

## Rendering & markup

- Missing or index-based `key` in a list that can reorder or filter.
- Conditional rendering with `&&` on a number or a possibly-`""` value — renders `0`.
- Deeply nested ternaries in JSX; extract or early-return.
- A wrapper `<div>` added for no styling reason — use a fragment.
- New interactive behavior on a `<div>`/`<span>` instead of `<button>`/`<a>` — kills keyboard
  and screen-reader access. Also check: focus moved into new modals/drawers and returned on close.
- Async UI with no loading and no error branch — a permanently blank region on failure.
- `dangerouslySetInnerHTML` on anything derived from user input.

## Visual consistency

Before reading the new component's code, find the closest existing one and read *that*. Then
diff. Most UI slop is invisible in isolation and obvious side by side.

First understand what part of UI you are building, then look for existing similar sections, components, sub-components and patterns established in our app, and try to reuse the UI as much as possible and try to keep the typography, spacings, layouting everything consistent.
