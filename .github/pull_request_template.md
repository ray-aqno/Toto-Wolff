## What does this PR do?

<!-- One paragraph. What changed and why. -->

## P10 plan reference

<!-- Link to the P10 plan in your vault, or write "N/A — mechanical change" -->

## Council ruling reference

<!-- Link to the Congressional Record if a /council session was run, or "N/A" -->

## Checklist

- [ ] `pnpm -r exec tsc --noEmit` exits 0
- [ ] `pnpm -r test` passes; test count did not decrease
- [ ] Every new exported function has a JSDoc docstring
- [ ] No new production npm dependencies (dev deps are fine)
- [ ] If a numeric boundary was added, it is a named constant with a comment
- [ ] No raw error internals in any HTTP response path I touched
- [ ] `grep -r "listen\b" packages/mcp-server/src/index.ts` still shows `127.0.0.1`
- [ ] If I changed `dashboard_html.ts`, every vault-sourced string is wrapped in `escHtml()`
