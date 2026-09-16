#!/usr/bin/env bash
set -euo pipefail

EXPECTED_TOOL_COUNT="${EXPECTED_TOOL_COUNT:-17}"
SERVER=(node build/index.js)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    fail=1
  fi
}

npx --no-install @modelcontextprotocol/inspector --cli "${SERVER[@]}" \
  --method tools/list --format json > "$TMP/tools.json"

jq_tools() { jq -e "$1" "$TMP/tools.json" > /dev/null; }

check "tools/list returns $EXPECTED_TOOL_COUNT tools" \
  jq_tools ".result.tools | length == $EXPECTED_TOOL_COUNT"

check "every tool has a description and a title" \
  jq_tools 'all(.result.tools[]; (.description | length > 0) and (.annotations.title | length > 0))'

check "every tool has an object input schema" \
  jq_tools 'all(.result.tools[]; .inputSchema.type == "object")'

check "no tool claims an open world" \
  jq_tools 'all(.result.tools[]; .annotations.openWorldHint == false)'

check "read-only tools carry no destructive or idempotent hint" \
  jq_tools 'all(.result.tools[] | select(.annotations.readOnlyHint == true);
                (.annotations.destructiveHint == null) and (.annotations.idempotentHint == null))'

check "stdout carries only JSON-RPC" node scripts/stdout-purity.mjs
check "server exits on stdin EOF" node scripts/exit-on-eof.mjs

exit "$fail"
