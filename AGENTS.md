# AGENTS.md

Instructions for coding agents (Devin and others). Read [CLAUDE.md](CLAUDE.md) first: it covers the
single-file architecture, security rules (`--` separation, Zod validation), and design principles.

## Build

```bash
pnpm install && pnpm build   # or npm; output is build/index.js
```

On pnpm 11 or later, `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` for the MCP inspector's
build script. The server doesn't need it: add `--config.strict-dep-builds=false`. Don't run
`pnpm approve-builds` or commit the config it writes.

## Test against a real simulator (macOS only)

There is no unit test suite, by design ([TESTING.md](TESTING.md) explains why). Verify changes
against a booted iOS Simulator instead:

1. Boot an iPhone and leave it booted: `xcrun simctl boot "<name or UDID>"`
   (`xcrun simctl list devices available` lists them). Keep it in portrait.
2. After building, run `scripts/simulator-smoke.sh`. It checks that idb sees the simulator and
   calls `get_booted_sim_id` and `ui_describe_all` through the MCP inspector CLI.
3. Exercise the tools your change touches, one concrete call per claim:
   `npx mcp-inspector --cli node build/index.js --method tools/call --tool-name <tool> --tool-arg key=value`
4. For a full pass, work through the scenarios in [QA.md](QA.md).

idb is required. If `idb` is not found, run `export PATH="$HOME/.local/bin:$PATH"`.
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) covers installation.

## Commits and pull requests

- Devin: do not add `Co-Authored-By: Devin` trailers or any other Devin attribution lines to
  commit messages.
- Use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`), matching `git log`.
- `pnpm-lock.yaml` is generated from `package-lock.json`. Don't hand-edit it. If dependencies
  change, change them with npm, then regenerate with `npx pnpm@<PNPM_VERSION> import`, using the
  version pinned in `.github/workflows/pnpm-lock-check.yml`.
- In the PR description, list each check you ran against the simulator and its result.
