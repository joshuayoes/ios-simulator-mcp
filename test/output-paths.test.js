// Output-path policy tests (issues #18 and #19): allow-listed directories
// and explicit-overwrite enforcement for screenshot and record_video.
// The policy is checked before any simulator interaction, so these tests
// run anywhere — no booted simulator or idb required.
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { McpTestClient } = require("./helpers/mcp-client");

function resultText(response) {
  return response.result.content[0].text;
}

describe("output directory allow-list (issue #18)", () => {
  const client = new McpTestClient();
  after(() => client.close());

  test("setup", async () => {
    await client.initialize();
  });

  test("screenshot outside the allow-list is rejected", async () => {
    const response = await client.callTool("screenshot", {
      output_path: "/etc/evil.png",
    });
    assert.equal(response.result.isError, true);
    assert.match(resultText(response), /not allowed/i);
  });

  test("screenshot cannot escape the allow-list with ../ traversal", async () => {
    const response = await client.callTool("screenshot", {
      output_path: path.join(os.homedir(), "Downloads", "..", ".ssh", "x.png"),
    });
    assert.equal(response.result.isError, true);
    assert.match(resultText(response), /not allowed/i);
  });

  test("record_video outside the allow-list is rejected", async () => {
    const response = await client.callTool("record_video", {
      output_path: "/usr/local/evil.mp4",
    });
    assert.equal(response.result.isError, true);
    assert.match(resultText(response), /not allowed/i);
  });

  test("the rejection message names the allowed directories", async () => {
    const response = await client.callTool("screenshot", {
      output_path: "/etc/evil.png",
    });
    assert.match(resultText(response), /Downloads/);
  });
});

describe("IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR extends the allow-list", () => {
  const customDir = fs.mkdtempSync(path.join(os.homedir(), ".ios-sim-mcp-"));
  const client = new McpTestClient({
    env: { IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR: customDir },
  });
  after(() => {
    client.close();
    fs.rmSync(customDir, { recursive: true, force: true });
  });

  test("paths inside the custom dir pass the policy check", async () => {
    await client.initialize();
    const response = await client.callTool("screenshot", {
      output_path: path.join(customDir, "shot.png"),
    });
    // The policy check passes; on machines without a booted simulator the
    // call may still fail later, but never with a policy error.
    if (response.result.isError) {
      assert.doesNotMatch(resultText(response), /not allowed/i);
    }
  });
});

describe("no silent file clobbering (issue #19)", () => {
  const client = new McpTestClient();
  const existingFile = path.join(os.tmpdir(), `ios-sim-mcp-existing-${process.pid}.png`);
  fs.writeFileSync(existingFile, "sentinel");
  after(() => {
    client.close();
    fs.rmSync(existingFile, { force: true });
  });

  test("setup", async () => {
    await client.initialize();
  });

  test("screenshot refuses to overwrite an existing file without force", async () => {
    const response = await client.callTool("screenshot", {
      output_path: existingFile,
    });
    assert.equal(response.result.isError, true);
    assert.match(resultText(response), /already exists/i);
    assert.equal(
      fs.readFileSync(existingFile, "utf-8"),
      "sentinel",
      "existing file must be untouched"
    );
  });

  test("record_video refuses to overwrite an existing file without force", async () => {
    const response = await client.callTool("record_video", {
      output_path: existingFile,
    });
    assert.equal(response.result.isError, true);
    assert.match(resultText(response), /already exists/i);
  });
});
