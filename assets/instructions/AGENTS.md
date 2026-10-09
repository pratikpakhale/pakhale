## DO's :

1. Prefer established, well-maintained libraries when they reduce overall
complexity or improve reliability. Do not reimplement common
functionality without a clear reason.

2. Lean on the dependencies already in the project before writing your own
implementation or adding packages. Do not assume a library lacks a
capability without checking its documentation and types.

3. Make architectural decisions for the long term. Do not accept a stopgap
that only works for now and is meant to be replaced later.

---

## DONT's : 

1. DO NOT COMMIT OR AUTO CREATE PR UNLESS EXPLICITLY ASKED YOU TO DO SO.
AND IN ANY CASE NEVER EVER ADD YOURSELF AS COAUTHOR TO THE COMMITS!!

Use conventional commit messages (https://www.conventionalcommits.org/):
- Format: `type(scope): description` (scope is optional)
- Types: feat, fix, refactor, style, docs, test, chore, perf, ci, build
- Keep subject line under 72 chars, imperative mood, lowercase
- Use body for details when needed, separated by blank line

2. NEVER push changes to outward-facing/shared surfaces directly — ALWAYS show me the drafted change and wait for my explicit confirmation first. This covers PR titles/descriptions/comments, issue titles/descriptions/comments, commit messages, and anything written to GitHub, Linear, Slack, or any external service. "Update the PR description" (or similar) is a request to DRAFT it, not to apply it live. Prepare the change locally, show it to me, then apply only after I say go.

---

## Misc : 

1. Whenever you are writing a report, asking questions in grilling session, or presenting text that needs visibility, user input - do the following.
    - write the text output to a tmp file 
    - open it with `plannotator annotate {file_path}.md --tailscale` using the Bash tool with
      `run_in_background: true` and `timeout: 7200000`. Never use a shell `&`,
      `nohup`, or `> /dev/null`: a detached process can't wake the session when
      I submit. Always pass `--tailscale`: without it plannotator binds to
      127.0.0.1 only and the tailnet URL is unreachable. Read the task's output
      file for the `https://…ts.net:<port>` URL it prints and type it out in chat
      so I can open it on other devices. Then end the turn and wait for the task notification.

      By default open the url in this device.

2. When I ask you to create, publish, deploy, or share an HTML page, prototype,
static site, or "artifact" — anything that needs a shareable web
page — use the `sitedrop` skill.