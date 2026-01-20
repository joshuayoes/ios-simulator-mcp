const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLaunchArgs } = require("../build/launch-app-env.js");

test("buildLaunchArgs maps env to SIMCTL_CHILD_ vars", () => {
  const result = buildLaunchArgs({
    udid: "UDID",
    bundleId: "com.example.app",
    terminateRunning: true,
    env: { FOO: "bar", " BAZ ": "qux" }
  });

  assert.deepEqual(result.args, [
    "launch",
    "--terminate-running-process",
    "UDID",
    "com.example.app"
  ]);

  assert.deepEqual(result.env, {
    SIMCTL_CHILD_BAZ: "qux",
    SIMCTL_CHILD_FOO: "bar"
  });
});
