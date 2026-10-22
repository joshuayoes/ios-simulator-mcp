#!/usr/bin/env bash
# Smoke-tests the built server (build/index.js) against a real iOS Simulator.
#
# Uses a booted iPhone simulator if there is one, otherwise boots the first
# available iPhone and shuts it down again on exit. Then checks that idb sees
# the simulator and calls two tools through the MCP inspector CLI:
# get_booted_sim_id (simctl path) and ui_describe_all (idb path). Exits non-zero
# on any failure, including a tool result with isError: true.
#
# Requires: macOS with Xcode, idb + idb_companion on PATH, jq, `npm install`
# (or `pnpm install`) and a build. Used by .devin/blueprint.yaml.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f build/index.js ]] || { echo "build/index.js missing: run the build first" >&2; exit 1; }

udid=$(xcrun simctl list devices available -j | jq -r '
  [.devices | to_entries[] | select(.key | test("iOS")) | .value[] | select(.name | startswith("iPhone"))]
  | (map(select(.state == "Booted")) + .)[0].udid // empty')
[[ -n "$udid" ]] || { echo "No available iPhone simulator found" >&2; exit 1; }

if xcrun simctl list devices booted | grep -q "$udid"; then
  echo "Using booted simulator $udid"
else
  echo "Booting simulator $udid"
  xcrun simctl boot "$udid"
  trap 'xcrun simctl shutdown "$udid" || true' EXIT
fi
xcrun simctl bootstatus "$udid" -b >/dev/null

echo "== idb list-targets"
idb list-targets | grep "$udid" | grep -q Booted || { echo "idb does not see $udid as Booted" >&2; exit 1; }

call() {
  npx --no-install mcp-inspector --cli node build/index.js --method tools/call --tool-name "$1" 2>/dev/null
}

echo "== get_booted_sim_id"
call get_booted_sim_id | jq -e --arg udid "$udid" '.isError == false and (.content[0].text | contains($udid))'

echo "== ui_describe_all"
call ui_describe_all | jq -e '.isError == false and (.content[0].text | fromjson | length > 0)' >/dev/null

echo "Simulator smoke test passed"
