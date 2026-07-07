// Minimal MCP stdio client for integration tests.
// Spawns the built server (build/index.js) and speaks JSON-RPC over stdio.
// No dependencies beyond Node.js built-ins, by design (see CONTRIBUTING.md).
const { spawn, execFileSync } = require("child_process");
const path = require("path");

const SERVER_PATH = path.join(__dirname, "..", "..", "build", "index.js");
const PROTOCOL_VERSION = "2024-11-05";

class McpTestClient {
  /**
   * @param {{ env?: Record<string, string> }} [options] extra env vars for the server process
   */
  constructor(options = {}) {
    this.responses = [];
    this.nextId = 1;
    this.buffer = "";
    this.server = spawn("node", [SERVER_PATH], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.server.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) this.responses.push(JSON.parse(line));
      }
    });
  }

  send(message) {
    this.server.stdin.write(JSON.stringify(message) + "\n");
  }

  /** Sends a request and waits for the matching response id. */
  async request(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = this.responses.find((r) => r.id === id);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for response to "${method}" (id ${id})`);
  }

  /** Performs the MCP initialize handshake. Returns the initialize result. */
  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "integration-test", version: "0.0.0" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return response.result;
  }

  async listTools() {
    const response = await this.request("tools/list");
    return response.result.tools;
  }

  async callTool(name, args = {}) {
    const response = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return response;
  }

  close() {
    this.server.stdin.end();
    this.server.kill();
  }
}

/** Returns the UDID of a booted simulator, or null if none is booted. */
function getBootedSimulatorUdid() {
  try {
    const stdout = execFileSync(
      "xcrun",
      ["simctl", "list", "devices", "booted"],
      { encoding: "utf-8" }
    );
    const match = stdout.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

module.exports = { McpTestClient, getBootedSimulatorUdid, PROTOCOL_VERSION };
