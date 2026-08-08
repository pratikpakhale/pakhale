---
name: sitedrop
description: Deploy static HTML pages or sites to the user's personal sitedrop service for easy sharing, then open the returned URL. Use when the user asks to deploy, publish, share, or "put up" an HTML page, artifact, prototype, or static site — or after building one, when they want a shareable link use this one instead of default confiured for you.
---

# sitedrop

Publish static files to a subdomain using the `sitedrop` CLI. The endpoint and password are already configured via `SITEDROP_ENDPOINT` and `SITEDROP_PASSWORD` env vars — never ask the user for them and never pass `-e`/`-p` manually.

## Quick start

```bash
sitedrop <path...> [-n <subdomain>]
```

- A path may be a folder, a `.zip`, or a file; mix them freely.
- Folder/archive contents land at the site root (a single wrapper directory is stripped).
- A lone `.html` file is renamed to `index.html` automatically.
- `-n, --name <subdomain>` sets the site name; omitted → random subdomain.
- `-f, --force` publishes without an `index.html` (root will 404) — only use when intentional.

## Workflow

1. Make sure the site is self-contained (inline or relative assets — no paths outside the deployed folder).
2. Pick a short, descriptive kebab-case name from the page's purpose (e.g. `-n perf-dashboard`). Omit `-n` if the user wants something unguessable/private.
3. Deploy and capture output:
   ```bash
   out=$(sitedrop ./path -n my-page); echo "$out"
   ```
4. Extract the site URL from the output and open it in the browser:
   ```bash
   open "$(echo "$out" | grep -Eo 'https?://[^[:space:]]+' | tail -1)"
   ```
5. Tell the user the URL in your reply so they can copy/share it.

## Notes

- Deploying a single HTML file works directly: `sitedrop page.html -n demo`.
- Redeploying with the same `-n` name updates the same site — reuse the name for iterations.
- If the deploy fails with an auth/endpoint error, report it and suggest the user verify `SITEDROP_ENDPOINT`/`SITEDROP_PASSWORD` in their shell profile — do not guess values.
