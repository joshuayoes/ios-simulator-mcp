# Testing & Verification Harness

> **What this is:** How ios-simulator-mcp is actually verified — a Claude-driven
> harness that runs the real server against a real booted simulator: the per-PR
> review recipe, the post-publish smoke test, and known hazards.
> **Status:** Living doc. No conventional test suite ships, by design; the
> long-term roadmap (scored evals) is tracked in the issue tracker.
> **Audience:** maintainer + review agents. Grep this header to decide whether to load the rest.

## Philosophy: why there is no conventional test suite

This repo deliberately ships no unit or integration suite. That is a decision,
not an omission — test strategies have been explored and contributed suites
have been proposed, but none has been merged:

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
   base from past reviews: a keystroke-based typing rewrite that passed the
   author's tests but produced `amazing jazz` → `amazingjazz.` + 45 trailing
   spaces on one harness run and clean output on the next; a parser whose regex
   expected `" = {"` where real simctl output has five spaces (zero apps found
   on a simulator with 28 installed); env-var propagation proven end-to-end
   with `ps eww -p <pid>` on the launched child rather than trusting the tool's
   success response. A mocked suite would have passed all three.

The long-term investment is an **eval** (scored, repeatable, trended), not test
inventory. That roadmap lives in the
[eval harness roadmap issue](https://github.com/joshuayoes/ios-simulator-mcp/issues/82).

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
spec in prose form, scripted scenario, run by an agent, judged by a human. This
guide does not duplicate it.

## Known hazards

- **Coordinate spaces:** describe/tap coordinate handling is inconsistent
  under rotation (known open bug). Until fixed, results are only trustworthy
  in **portrait**. Pin orientation in every run.
- **a11y-snapshot instability:** XCTest has a hard 60-level depth ceiling and
  truncates **silently** — deep hierarchies (React Native, nested SwiftUI)
  yield false negatives with no error. Trees are for *grounding* (finding
  things), not for asserting outcomes.
- **Payload size:** Claude Code truncates tool results around ~25k tokens. An
  oversized `ui_view` image or a full `ui_describe_all` tree on a busy screen
  fails as "agent couldn't see" — distinguish that from a real agent failure
  before trusting a verdict.

## References

- MCP spec: [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- Anthropic: [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Eval harness roadmap issue](https://github.com/joshuayoes/ios-simulator-mcp/issues/82) (target architecture, conformance tooling)
- Related repo docs: [QA.md](QA.md) (release scenario) · [CONTRIBUTING.md](CONTRIBUTING.md) (philosophy) · [CONTEXT.md](CONTEXT.md) (reference links)
