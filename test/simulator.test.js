// Simulator-dependent integration tests. These exercise real xcrun/idb
// behavior and are skipped automatically when no simulator is booted,
// so `npm test` stays green on machines (and CI runners) without one.
//
// To run locally: boot a simulator first (xcrun simctl boot <udid>).
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  McpTestClient,
  getBootedSimulatorUdid,
} = require("./helpers/mcp-client");

const bootedUdid = getBootedSimulatorUdid();
const skip = bootedUdid
  ? false
  : "requires a booted iOS simulator (xcrun simctl boot <udid>)";

describe("against a booted simulator", { skip }, () => {
  const client = new McpTestClient();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-sim-mcp-test-"));
  after(() => {
    client.close();
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test("setup", async () => {
    await client.initialize();
  });

  test("get_booted_sim_id reports the booted device", async () => {
    const response = await client.callTool("get_booted_sim_id");
    assert.equal(response.result.isError, false);
    assert.match(response.result.content[0].text, new RegExp(bootedUdid));
  });

  test("screenshot writes a PNG to the requested absolute path", async () => {
    const outputPath = path.join(outputDir, "screenshot.png");
    const response = await client.callTool("screenshot", {
      output_path: outputPath,
      type: "png",
    });
    assert.equal(response.result.isError, false);
    assert.ok(fs.existsSync(outputPath), "screenshot file was not created");
    // PNG magic number
    const header = fs.readFileSync(outputPath).subarray(0, 4);
    assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47]);
  });

  test("launch_app launches Safari and reports a PID", async () => {
    const response = await client.callTool("launch_app", {
      bundle_id: "com.apple.mobilesafari",
      terminate_running: true,
    });
    assert.equal(response.result.isError, false);
    assert.match(response.result.content[0].text, /launched successfully/);
  });

  test("launch_app fails clearly for an unknown bundle id", async () => {
    const response = await client.callTool("launch_app", {
      bundle_id: "com.example.does.not.exist",
    });
    assert.equal(response.result.isError, true);
  });
});
