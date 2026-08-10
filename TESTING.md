# Testing & Verification Harness

> **What this is:** How ios-simulator-mcp is actually verified — a Claude-driven
> harness that runs the real server against a real booted simulator — plus the
> spec-conformance checklist and the target eval architecture.
> **Status:** Living doc. Written against MCP spec revision 2026-07-28; this
> server currently speaks the **legacy (initialize-handshake) wire era** — see
> [Wire era](#wire-era). Test suite PRs: none merged; PR #75 open, undecided.
> **Audience:** maintainer + review agents. Grep this header to decide whether to load the rest.

## Philosophy: why there is no conventional test suite

This repo deliberately ships no unit or integration suite. That is a decision,
not an omission (issue #21 explored strategies; contributed suites have not
been merged — PR #75 remains open):

1. **The failure modes live outside the process.** The bugs that matter are in
   the seam between the server and `simctl`/`idb`/macOS: plist output with five
   spaces where a regex expected one, keystrokes that land differently
   run-to-run, env vars that don't survive into a child process. Mocking those
   seams tests the mock.
2. **The product is agent-tool interaction.** The unit of value isn't "function
   returns X" — it's "an agent, given these tool descriptions, accomplishes a
   UI task on a simulator." That is only observable by running an agent.
3. **Claims-based verification scales with review effort.** Every PR claim gets
   one concrete tool-call check against a real booted simulator. The evidence
   base: non-determinism caught in PR #44 (`amazing jazz` → `amazingjazz.` + 45
   trailing spaces on one run, clean on the next), real-output parsing bugs in
   PR #61 (regex expected `" = {"`, real simctl emits five spaces), end-to-end
   env propagation proof in PR #47 (`ps eww -p <pid>` on the launched child).
   A mocked suite would have passed all three.

The long-term investment is an **eval** (scored, repeatable, trended), not test
inventory. The [target architecture](#target-eval-architecture) below is that
roadmap.

## Current practice

### Per-PR review harness

Each PR gets a sandboxed Claude Code session where the **only** MCP server
available is that PR's own build.

```bash
# 1. Isolated checkout + build
git worktree add ~/Code/ios-simulator-mcp-prNN && cd ~/Code/ios-simulator-mcp-prNN
gh pr checkout NN && npm install && npm run build

# 2. Namespaced .mcp.json so transcripts self-identify
cat > .mcp.json <<'EOF'
{ "mcpServers": { "ios-simulator-prNN": { "command": "node", "args": ["./build/index.js"] } } }
EOF

# 3. One simulator booted up front; hard-code the UDID in the prompt
xcrun simctl boot "iPhone 17 Pro" && open -a Simulator
xcrun simctl list devices | grep Booted

# 4. Launch with the isolation flag that makes the whole thing work
claude --mcp-config .mcp.json --strict-mcp-config
```

`--strict-mcp-config` is load-bearing: without it, user/enterprise/plugin MCP
servers merge in and "only the PR's code is under test" stops being true.
Because the surface is scoped this tightly, subagents can run with
`--permission-mode bypassPermissions`.

**The review prompt is the test spec.** Every review runs from the same
skeleton:

| Block | Content |
| --- | --- |
| Context | branch, booted UDID, note that the session is `--strict-mcp-config` |
| Background | what the PR claims, prior review feedback, the bug it fixes |
| Read first | `CLAUDE.md`, `git log main..HEAD --stat`, `git diff main -- <scope>` |
| Empirical checks | **one concrete tool call per claim**, expected output stated; plus beyond-the-plan checks (size comparisons, multi-param combos, inputs zod should reject) |
| Code concerns | specific lines and patterns, not "please review" |
| Red flags | lockfile drift, spam approvals, unrelated formatting churn |
| Deliverables | fixed four: per-check punch list (verified/failed/concern) → verdict from a fixed menu (ship as-is / ship after maintainer fixup / ship after author adds X / needs rework) → draft squash commit → draft PR comment |

### Post-publish smoke test

Proves the **published npm artifact**, not the local build:

```bash
mkdir /tmp/ios-sim-mcp-smoke-X.Y.Z && cd /tmp/ios-sim-mcp-smoke-X.Y.Z
cat > .mcp.json <<'EOF'
{ "mcpServers": { "ios-simulator": { "command": "npx", "args": ["-y", "ios-simulator-mcp@X.Y.Z"] } } }
EOF
# prompt.txt: exercise each new feature + one sanity check per bug fix
cat prompt.txt | claude -p --mcp-config .mcp.json --strict-mcp-config \
  --permission-mode bypassPermissions 2>&1 | tee output.txt
```

`npx -y ios-simulator-mcp@X.Y.Z` pins the exact published version; `claude -p`
runs non-interactively and leaves a transcript.

### Manual release scenario

[QA.md](QA.md) is a scripted agent transcript — one version-agnostic Settings
scenario exercising every tool — pasted into an MCP client on release: an eval
spec in prose form, scripted scenario, run by an agent, judged by a human. The
eval roadmap mechanizes it; until then it stays the release checklist. This
guide does not duplicate it.

## Wire era

As of the SDK v2 migration (PR #80), the server uses
`@modelcontextprotocol/server` ^2.0.0 with zod ^4.2 and `registerTool()`, and
connects via `server.connect(new StdioServerTransport())` from
`@modelcontextprotocol/server/stdio`.

**That still speaks the legacy wire era.** MCP spec revision
[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
removed the `initialize` handshake and protocol-level sessions — modern MCP is
stateless, with per-request `_meta` and required `server/discover`. SDK v2 is
dual-era-*capable* via `serveStdio()`, but adopting it was explicitly deferred;
today's clients still fall back to the legacy handshake, so staying legacy is
defensible. Just don't read "SDK v2" as "2026-07-28 conformant" — it isn't, and
this section is the place that says so.

## Spec-conformance checklist

Runnable by a maintainer or an agent. Grounded in spec 2026-07-28
([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) ·
[stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)).
Status column reflects what `src/index.ts` does **today**, checked against
source — gaps are TODOs, not aspirations.

| # | Check | Why it matters | Status |
| --- | --- | --- | --- |
| 1 | **stdout purity**: only newline-delimited MCP JSON on stdout | A subprocess leaking to stdout is the classic stdio killer. Child output is piped (safe), **but** the stdin-close handler `console.log`s a farewell to stdout. Legacy clients tolerated it; it's still a violation. Highest-value automated check. | ⚠️ TODO — route to stderr |
| 2 | **Exit on stdin EOF without orphaning children** | The close handler runs cleanup but never exits; an active `simctl io recordVideo` child keeps the event loop alive → hung server + orphaned recording. Exactly our failure mode. | ❌ TODO — kill children, `process.exit` |
| 3 | Handle `notifications/cancelled` for long calls | Handlers ignore `ctx.mcpReq.signal`; a cancelled `record_video` keeps recording. | ❌ TODO |
| 4 | `tools/list`: deterministic order | Fixed registration order in a single file. | ✅ |
| 5 | `inputSchema`: valid JSON Schema 2020-12, never null | zod 4 emits draft 2020-12; verified by deep-diff against a v1 baseline during the SDK v2 migration. | ✅ |
| 6 | **Annotations are claims with unsafe defaults** (`readOnlyHint` false, `destructiveHint` true, `openWorldHint` true when unset) — annotate every tool deliberately | Every tool has `title` + `readOnlyHint` (describe/view tools true). But `openWorldHint` is `true` on every tool — a local booted sim is a **closed** world, should be `false`. `destructiveHint` is never set (tap/type/swipe default to destructive, which is right, but it's accidental, not deliberate). | ⚠️ TODO — flip `openWorldHint`, set `destructiveHint` explicitly |
| 7 | **Error-channel discipline**: `isError: true` + actionable prose for anything the model can fix; `-32602` for unknown tool / schema violations; never surface tool failures as protocol errors; `-32020`–`-32099` is spec-reserved | Tool failures return `isError: true` with troubleshooting links; schema violations and unknown tools return `-32602`. Verified empirically (17-case adversarial suite, PR #80). | ✅ |
| 8 | **Statelessness direction**: no implicit cross-call state | `udid` is an optional arg with an implicit "currently booted sim" fallback. Convenient today; non-conformant direction — a stdio process is not a session, and clients may interleave conversations. UDID belongs in args; any future cross-call state should be an explicit server-minted handle. | ⚠️ documented direction, no change yet |

### Tooling for the checklist

- **[`@modelcontextprotocol/conformance`](https://github.com/modelcontextprotocol/conformance)**
  — the official suite. MUST → FAILURE, SHOULD → WARNING;
  `--expected-failures baseline.yml` makes known failures exit 0 while
  regressions *and* stale baseline entries exit 1. ⚠️ The documented entry
  point is HTTP (`--url`) — verify stdio support before wiring it into CI.
- **MCP Inspector 2.x CLI** — one request per process, `--format json`, stable
  exit codes (0 ok / 4 server unreachable / 5 tool error), so shell chains can
  distinguish "didn't start" from "tool errored" without parsing:

  ```bash
  npx @modelcontextprotocol/inspector --cli node build/index.js \
    --method tools/list --format json \
    | jq -e '.tools | length == 14 and all(.annotations.openWorldHint == false)'
  ```

  It cannot do assertions, multi-step scenarios, or schema validation — that
  layer is the eval.

## Target eval architecture

Four layers. Design, not implementation — nothing below exists yet.

### L1 — Conformance gate (deterministic, no model, per-PR)

The conformance suite (pinned, with `baseline.yml`) plus ~100 lines of
`inspector --cli --format json | jq -e` checks covering the checklist above:
annotations, stdout purity, EOF exit, orphan detection. Runs inside the
existing per-PR worktree harness. This is the only layer fast and deterministic
enough to gate merges.

### L2 — Suite A: capability episodes (model in loop, release-time)

Can Claude, driving this server, accomplish a real UI task? 20–50 tasks drawn
from **real observed failures**, not hypotheticals.

Episode contract (the OSWorld/AndroidWorld shape):
`reset → seeded setup → agent loop (step budget ~2× human steps, always stated)
→ grade final state → teardown`. **Grade final state, never action sequences**
— agents find valid routes you didn't anticipate.

Graders are composable getter × metric pairs (OSWorld pattern): getters like
`get_app_container_sqlite`, `get_userdefaults_plist`, `get_oslog_events`;
metrics like `plist_key_equals`, `rows_added_exactly`, `element_exists`.

**Primary oracle = programmatic simulator state — not screenshots, not an LLM
judge.** The `simctl` substrate makes iOS unusually gradeable:

```bash
# App state: UserDefaults / Core Data straight from the container
xcrun simctl get_app_container booted <bundle> data   # → sqlite3 / plutil
# Runtime asserts
xcrun simctl spawn booted log stream --predicate '...'
# Deterministic permission branches
xcrun simctl privacy booted grant|revoke|reset photos <bundle>
# Pin the environment
xcrun simctl status_bar booted override --time "9:41" && xcrun simctl ui booted appearance dark
```

Reset ladder: **clone from a golden seeded device** into an isolated `--set`
device set — never `erase` per task.

Differentiation, stated precisely: [iOSWorld](https://arxiv.org/abs/2606.09764)
— the only interactive iOS agent benchmark — uses none of these hooks. It is
rubric-judge-graded (GPT-based, trajectory-level) with build-time seeded
fixtures, zero container/DB inspection, and no per-task rollback. That's
"iOSWorld doesn't do this" (verified), not "nobody does" (absence of evidence).

### L3 — Suite B: affordance episodes (the `ui_view` problem)

Does the model reach for the right tool unprompted? Task fixed, **tool catalog
varied** with 0 / 3 / 10 distractor tools — and our realistic distractors are
free: Bash with raw `xcrun simctl`, Read, a browser MCP. Score tool-selection
TPR/FPR, argument validity, routing F1.

Improve descriptions by feeding the model its own FP/FN transcripts: a single
rewrite captures ~90% of what ten refinement iterations get
([arXiv 2606.30775](https://arxiv.org/abs/2606.30775)). Hold out prompts to
avoid overfitting. Suite A and Suite B stay separate — conflating "can it do
the task" with "does it pick the tool" makes both unreadable.

### L4 — Reporting standards

- **pass@1 tracked; pass^k (k=3) is the release gate** — capability is
  pass@k's job, flake-resistance is pass^k's.
- Per-episode: tokens, tool calls, steps-to-completion. Tools buy *efficiency*
  and the advantage shrinks with step budget (OSWorld-MCP) — measure it.
- **Hard split between harness failure and agent failure** (setup-failed /
  sim-wedged / tool-errored / snapshot-truncated / grader-errored vs
  agent-gave-up / agent-wrong), with separate denominators. Never score a
  broken grader as an agent failure.
- Pin and record Xcode, iOS runtime, server, and model versions per run.
  Every Suite A metric is confounded by the model — prefer relative
  comparisons (before/after description, MCP tools vs raw bash), which cancel
  most model drift.
- LLM judge only for residue that state can't reach, share capped, and **never
  fed the agent's own final self-report** (judges reading self-reports is the
  documented failure mode behind inflated web-agent numbers).
- Every task ships a scripted `cheat()` oracle — a known-correct solution that
  must pass the grader before the task counts. QA.md's scenario steps are
  oracle steps waiting for state assertions.
- Someone reads transcripts before believing a number.

## Known hazards

- **Coordinate spaces (issue #49):** describe/tap coordinate handling is
  inconsistent under rotation. Until fixed, results are only trustworthy in
  **portrait**. Pin orientation in every episode.
- **a11y-snapshot instability:** XCTest has a hard 60-level depth ceiling and
  truncates **silently** — deep hierarchies (React Native, nested SwiftUI)
  yield false negatives with no error. Trees are for *grounding* (finding
  things), state is for *asserting*. Never write a grader on tree contents.
- **Payload size is eval-visible:** Claude Code truncates tool results around
  ~25k tokens. An oversized `ui_view` image or a full `ui_describe_all` tree on
  a busy screen fails as "agent couldn't see," which grades as an agent failure
  unless the harness/agent split catches it.

## References

- MCP spec 2026-07-28: [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) · [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Conformance suite](https://github.com/modelcontextprotocol/conformance) · [Inspector CLI](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli)
- Anthropic: [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Benchmarks: [iOSWorld](https://arxiv.org/abs/2606.09764) · [OSWorld](https://github.com/xlang-ai/OSWorld) · [AndroidWorld](https://github.com/google-research/android_world) · [MCP-Universe](https://arxiv.org/pdf/2508.14704)
- Related repo docs: [QA.md](QA.md) (release scenario) · [CONTRIBUTING.md](CONTRIBUTING.md) (philosophy) · [CONTEXT.md](CONTEXT.md) (reference links)
