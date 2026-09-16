import { spawn } from "node:child_process";

const TIMEOUT_MS = 5000;
const server = spawn("node", ["build/index.js"], { stdio: ["pipe", "pipe", "ignore"] });
server.stdout.resume();
server.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gate", version: "1" } },
  }) + "\n",
);

await new Promise((r) => setTimeout(r, 1000));
server.stdin.end();

const exited = await Promise.race([
  new Promise((r) => server.on("exit", () => r(true))),
  new Promise((r) => setTimeout(() => r(false), TIMEOUT_MS)),
]);

if (!exited) {
  server.kill("SIGKILL");
  console.error(`server still running ${TIMEOUT_MS}ms after stdin EOF`);
  process.exit(1);
}
