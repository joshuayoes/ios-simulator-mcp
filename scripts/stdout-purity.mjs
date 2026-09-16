import { spawn } from "node:child_process";

const server = spawn("node", ["build/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
const chunks = [];
server.stdout.on("data", (d) => chunks.push(d));

const send = (msg) => server.stdin.write(JSON.stringify(msg) + "\n");
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gate", version: "1" } },
});
await new Promise((r) => setTimeout(r, 1000));
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_booted_sim_id", arguments: {} } });
send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ui_tap", arguments: { x: -1, y: -1 } } });
await new Promise((r) => setTimeout(r, 4000));
server.stdin.end();
server.kill();

const offenders = Buffer.concat(chunks)
  .toString()
  .split("\n")
  .filter((line) => line.trim())
  .filter((line) => {
    try {
      return JSON.parse(line).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });

if (offenders.length) {
  console.error(`non-JSON-RPC output on stdout:\n${offenders.slice(0, 5).join("\n")}`);
  process.exit(1);
}
