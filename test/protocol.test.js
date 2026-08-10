// Protocol-level integration tests: spawn the real built server and speak
// MCP over stdio. These tests do NOT require a booted simulator or idb,
// so they can run in CI on any macOS/Linux runner with Node.js.
//
// Run with: npm test (builds first, then `node --test test/`)
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const { McpTestClient } = require("./helpers/mcp-client");
const packageJson = require("../package.json");

const ALL_TOOLS = [
  "get_booted_sim_id",
  "open_simulator",
  "ui_describe_all",
  "ui_tap",
  "ui_type",
  "ui_swipe",
  "ui_describe_point",
  "ui_find_element",
  "ui_view",
  "screenshot",
  "record_video",
  "stop_recording",
  "install_app",
  "launch_app",
];

describe("MCP handshake", () => {
  const client = new McpTestClient();
  after(() => client.close());

  test("initialize returns server name and package.json version", async () => {
    const result = await client.initialize();
    assert.equal(result.serverInfo.name, "ios-simulator");
    assert.equal(result.serverInfo.version, packageJson.version);
  });

  test("tools/list exposes every documented tool", async () => {
    const tools = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...ALL_TOOLS].sort());
  });

  test("every tool has a non-empty description", async () => {
    const tools = await client.listTools();
    for (const tool of tools) {
      assert.ok(
        typeof tool.description === "string" && tool.description.length > 0,
        `tool ${tool.name} is missing a description`
      );
    }
  });
});

describe("tool filtering via IOS_SIMULATOR_MCP_FILTERED_TOOLS", () => {
  test("filtered tools are not registered", async () => {
    const client = new McpTestClient({
      env: { IOS_SIMULATOR_MCP_FILTERED_TOOLS: "record_video, stop_recording" },
    });
    try {
      await client.initialize();
      const names = (await client.listTools()).map((tool) => tool.name);
      assert.ok(!names.includes("record_video"));
      assert.ok(!names.includes("stop_recording"));
      assert.ok(names.includes("ui_tap"));
    } finally {
      client.close();
    }
  });
});

describe("input validation (zod schemas)", () => {
  const client = new McpTestClient();
  after(() => client.close());

  test("setup", async () => {
    await client.initialize();
  });

  test("ui_tap rejects a malformed udid", async () => {
    const response = await client.callTool("ui_tap", {
      udid: "not-a-udid; rm -rf /",
      x: 10,
      y: 10,
    });
    assert.ok(
      response.error || response.result.isError,
      "malformed udid must be rejected"
    );
  });

  test("ui_type rejects non-ASCII text", async () => {
    const response = await client.callTool("ui_type", {
      udid: "37A360EC-75F9-4AEC-8EFA-10F4A58D8CCA",
      text: "héllo wörld 👋",
    });
    assert.ok(
      response.error || response.result.isError,
      "non-ASCII text must be rejected by the current schema"
    );
  });

  test("ui_type rejects text longer than 500 characters", async () => {
    const response = await client.callTool("ui_type", {
      udid: "37A360EC-75F9-4AEC-8EFA-10F4A58D8CCA",
      text: "a".repeat(501),
    });
    assert.ok(response.error || response.result.isError);
  });

  test("ui_tap rejects a non-numeric duration", async () => {
    const response = await client.callTool("ui_tap", {
      duration: "1; echo pwned",
      x: 10,
      y: 10,
    });
    assert.ok(response.error || response.result.isError);
  });

  test("screenshot rejects an unsupported image type", async () => {
    const response = await client.callTool("screenshot", {
      output_path: "test.png",
      type: "webp",
    });
    assert.ok(response.error || response.result.isError);
  });

  test("install_app fails clearly when the bundle does not exist", async () => {
    const response = await client.callTool("install_app", {
      udid: "37A360EC-75F9-4AEC-8EFA-10F4A58D8CCA",
      app_path: "/nonexistent/path/Fake.app",
    });
    assert.ok(response.result.isError);
    const text = response.result.content[0].text;
    assert.match(text, /not found/i);
  });
});
