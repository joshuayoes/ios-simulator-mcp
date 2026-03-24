#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import path from "path";
import os from "os";
import fs from "fs";

const execFileAsync = promisify(execFile);

/**
 * Strict UDID/UUID pattern: 8-4-4-4-12 hexadecimal characters (e.g. 37A360EC-75F9-4AEC-8EFA-10F4A58D8CCA)
 */
const UDID_REGEX =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

const TMP_ROOT_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "ios-simulator-mcp-")
);
const DEFAULT_SWIPE_DURATION_SECONDS = "1";
const DEFAULT_SWIPE_DURATION_MS = 1000;
const WDA_BUNDLE_ID = "com.facebook.WebDriverAgentRunner.xctrunner";
const WDA_REPO_URL = "https://github.com/appium/WebDriverAgent.git";
const WDA_CACHE_DIR = path.join(os.homedir(), ".ios-simulator-mcp", "wda");
const WDA_REPO_DIR = path.join(WDA_CACHE_DIR, "repo");
const WDA_DERIVED_DATA_DIR = path.join(WDA_CACHE_DIR, "DerivedData");
const WDA_APP_PATH = path.join(
  WDA_DERIVED_DATA_DIR,
  "Build",
  "Products",
  "Debug-iphonesimulator",
  "WebDriverAgentRunner-Runner.app"
);
const WDA_BUILD_TIMEOUT_MS = 120_000;
const WDA_BUILD_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const WDA_START_TIMEOUT_MS = 10_000;
const WDA_STATUS_POLL_INTERVAL_MS = 100;
const WDA_PORT_SEARCH_LIMIT = 100;
const parsedWdaPort = Number.parseInt(
  process.env.IOS_SIMULATOR_MCP_WDA_PORT ?? "",
  10
);
const WDA_PORT_START = Number.isFinite(parsedWdaPort) ? parsedWdaPort : 8100;
const wdaPortsByDeviceId = new Map<string, number>();
let wdaPortLock = Promise.resolve();
const ERROR_SUMMARY_MAX_CHARS = 300;

/**
 * Runs a command with arguments and returns the stdout and stderr
 * @param cmd - The command to run
 * @param args - The arguments to pass to the command
 * @returns The stdout and stderr of the command
 */
async function run(
  cmd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    shell: false,
    ...(options?.env ? { env: options.env } : {}),
  });
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

/**
 * Gets the IDB command path from environment variable or defaults to "idb"
 * @returns The path to the IDB executable
 * @throws Error if custom path is specified but doesn't exist
 */
function getIdbPath(): string {
  const customPath = process.env.IOS_SIMULATOR_MCP_IDB_PATH;

  if (customPath) {
    // Expand tilde if present
    const expandedPath = customPath.startsWith("~/")
      ? path.join(os.homedir(), customPath.slice(2))
      : customPath;

    // Check if the path exists
    if (!fs.existsSync(expandedPath)) {
      throw new Error(
        `Custom IDB path specified in IOS_SIMULATOR_MCP_IDB_PATH does not exist: ${expandedPath}`
      );
    }

    return expandedPath;
  }

  return "idb";
}

/**
 * Runs the idb command with the given arguments
 * @param args - arguments to pass to the idb command
 * @returns The stdout and stderr of the command
 * @see https://fbidb.io/docs/commands for documentation of available idb commands
 */
async function idb(...args: string[]) {
  return run(getIdbPath(), args);
}

// Read filtered tools from environment variable
const FILTERED_TOOLS =
  process.env.IOS_SIMULATOR_MCP_FILTERED_TOOLS?.split(",").map((tool) =>
    tool.trim()
  ) || [];

// Function to check if a tool is filtered
function isToolFiltered(toolName: string): boolean {
  return FILTERED_TOOLS.includes(toolName);
}

const server = new McpServer({
  name: "ios-simulator",
  version: require("../package.json").version,
});

function toError(input: unknown): Error {
  if (input instanceof Error) return input;

  if (
    typeof input === "object" &&
    input &&
    "message" in input &&
    typeof input.message === "string"
  )
    return new Error(input.message);

  return new Error(JSON.stringify(input));
}

function summarizeErrorMessage(message: string): string {
  const compactMessage = message
    .split("\n")[0]
    .split(" | stdout:")[0]
    .split(" | stderr:")[0]
    .trim();

  if (compactMessage.length <= ERROR_SUMMARY_MAX_CHARS) {
    return compactMessage;
  }

  return `${compactMessage.slice(0, ERROR_SUMMARY_MAX_CHARS - 3)}...`;
}

async function writeTempLog(prefix: string, contents: string): Promise<string> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logPath = path.join(TMP_ROOT_DIR, `${prefix}-${uniqueSuffix}.log`);
  await fs.promises.writeFile(logPath, contents, "utf8");
  return logPath;
}

function describeCommandError(error: unknown): string {
  const baseMessage = toError(error).message;
  const details = new Set<string>();

  if (baseMessage) {
    details.add(baseMessage);
  }

  if (typeof error === "object" && error !== null) {
    if ("code" in error && typeof error.code === "number") {
      details.add(`exit code ${error.code}`);
    }

    if ("signal" in error && typeof error.signal === "string" && error.signal) {
      details.add(`signal ${error.signal}`);
    }

    if ("stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) {
      details.add(`stdout: ${error.stdout.trim()}`);
    }

    if ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) {
      details.add(`stderr: ${error.stderr.trim()}`);
    }
  }

  return Array.from(details).join(" | ");
}

function troubleshootingLink(): string {
  return "[Troubleshooting Guide](https://github.com/joshuayoes/ios-simulator-mcp/blob/main/TROUBLESHOOTING.md) | [Plain Text Guide for LLMs](https://raw.githubusercontent.com/joshuayoes/ios-simulator-mcp/refs/heads/main/TROUBLESHOOTING.md)";
}

function errorWithTroubleshooting(message: string): string {
  return `${message}\n\nFor help, see the ${troubleshootingLink()}`;
}

type BootedDevice = {
  id: string;
  name: string;
};

type SimctlDevice = {
  name?: string;
  state?: string;
  udid?: string;
};

type SimctlListDevicesResponse = {
  devices?: Record<string, SimctlDevice[]>;
};

type WdaStatusResponse = {
  value?: {
    ready?: boolean;
  };
};

type WdaLaunchResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

type WdaPortForSwipeResult =
  | {
      port: number;
    }
  | {
      port: null;
      reason: string;
    };

function isBootedDevice(
  device: SimctlDevice
): device is SimctlDevice & { name: string; state: "Booted"; udid: string } {
  return (
    device.state === "Booted" &&
    typeof device.name === "string" &&
    typeof device.udid === "string"
  );
}

async function getBootedDevices(): Promise<BootedDevice[]> {
  const { stdout, stderr } = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "--json",
  ]);

  if (stderr) throw new Error(stderr);

  const devices = (JSON.parse(stdout) as SimctlListDevicesResponse).devices ?? {};
  const bootedDevices = Object.values(devices)
    .flat()
    .filter(isBootedDevice)
    .map((device) => ({
      name: device.name,
      id: device.udid,
    }));

  if (bootedDevices.length === 0) {
    throw Error("No booted simulator found");
  }

  return bootedDevices;
}

async function getBootedDevice(): Promise<BootedDevice> {
  return (await getBootedDevices())[0];
}

async function getBootedDeviceId(
  deviceId: string | undefined
): Promise<string> {
  // If deviceId not provided, get the currently booted simulator
  let actualDeviceId = deviceId;
  if (!actualDeviceId) {
    const { id } = await getBootedDevice();
    actualDeviceId = id;
  }
  if (!actualDeviceId) {
    throw new Error("No booted simulator found and no deviceId provided");
  }
  return actualDeviceId;
}

function getWdaBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getSwipeDurationSeconds(duration: string | undefined): string {
  return duration ?? DEFAULT_SWIPE_DURATION_SECONDS;
}

function getSwipeDurationMs(duration: string | undefined): number {
  if (!duration) {
    return DEFAULT_SWIPE_DURATION_MS;
  }

  return Math.max(1, Math.round(Number(duration) * 1000));
}

async function withWdaPortLock<T>(fn: () => Promise<T>): Promise<T> {
  let releaseLock = () => {};
  const nextLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const previousLock = wdaPortLock;
  wdaPortLock = previousLock.then(() => nextLock);

  await previousLock;

  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

async function getListeningPidsForPort(port: number): Promise<string[]> {
  try {
    const { stdout } = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return Array.from(new Set(stdout.split(/\s+/).filter(Boolean)));
  } catch {
    return [];
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return (await getListeningPidsForPort(port)).length === 0;
}

function pruneWdaPorts(bootedDevices: BootedDevice[]): void {
  const bootedDeviceIds = new Set(bootedDevices.map((device) => device.id));

  for (const deviceId of wdaPortsByDeviceId.keys()) {
    if (!bootedDeviceIds.has(deviceId)) {
      wdaPortsByDeviceId.delete(deviceId);
    }
  }
}

async function isWdaRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`${getWdaBaseUrl(port)}/status`);
    if (!response.ok) return false;

    const payload = (await response.json()) as WdaStatusResponse;
    return payload.value?.ready === true;
  } catch {
    return false;
  }
}

async function getWdaDeviceIdForPort(port: number): Promise<string | null> {
  const pids = await getListeningPidsForPort(port);

  for (const pid of pids) {
    try {
      const { stdout: command } = await run("ps", ["-p", pid, "-o", "command="]);
      const match = command.match(/CoreSimulator\/Devices\/([0-9A-Fa-f-]{36})\//);

      if (match) {
        return match[1].toUpperCase();
      }
    } catch {
      // Ignore transient process lookup failures and keep checking any remaining PIDs.
    }
  }

  return null;
}

function removeWdaPortMappings(port: number): void {
  for (const [deviceId, mappedPort] of wdaPortsByDeviceId.entries()) {
    if (mappedPort === port) {
      wdaPortsByDeviceId.delete(deviceId);
    }
  }
}

async function getVerifiedWdaDeviceIdForPort(
  port: number,
  expectedDeviceId: string
): Promise<string> {
  const runningDeviceId = await getWdaDeviceIdForPort(port);

  if (!runningDeviceId) {
    throw new Error(
      `WebDriverAgent is responding on port ${port}, but the owning simulator could not be determined`
    );
  }

  const normalizedExpectedDeviceId = expectedDeviceId.toUpperCase();
  if (runningDeviceId !== normalizedExpectedDeviceId) {
    throw new Error(
      `WebDriverAgent port ${port} belongs to simulator ${runningDeviceId}, not requested simulator ${normalizedExpectedDeviceId}`
    );
  }

  return runningDeviceId;
}

function getWdaSessionId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  if (
    "value" in payload &&
    typeof payload.value === "object" &&
    payload.value !== null &&
    "sessionId" in payload.value &&
    typeof payload.value.sessionId === "string"
  ) {
    return payload.value.sessionId;
  }

  if ("sessionId" in payload && typeof payload.sessionId === "string") {
    return payload.sessionId;
  }

  return null;
}

async function createWdaSession(port: number): Promise<string> {
  const response = await fetch(`${getWdaBaseUrl(port)}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          platformName: "iOS",
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create WebDriverAgent session: ${response.status} ${await response.text()}`
    );
  }

  const payload = await response.json();
  const sessionId = getWdaSessionId(payload);
  if (!sessionId) {
    throw new Error(
      `Invalid WebDriverAgent session response: ${JSON.stringify(payload)}`
    );
  }

  return sessionId;
}

async function deleteWdaSession(
  port: number,
  sessionId: string
): Promise<void> {
  try {
    await fetch(`${getWdaBaseUrl(port)}/session/${sessionId}`, { method: "DELETE" });
  } catch {
    // Ignore cleanup errors because the swipe itself has already completed or failed.
  }
}

async function withWdaSession<T>(
  port: number,
  fn: (sessionUrl: string) => Promise<T>
): Promise<T> {
  const sessionId = await createWdaSession(port);

  try {
    return await fn(`${getWdaBaseUrl(port)}/session/${sessionId}`);
  } finally {
    await deleteWdaSession(port, sessionId);
  }
}

async function clearWdaActions(sessionUrl: string): Promise<void> {
  try {
    await fetch(`${sessionUrl}/actions`, { method: "DELETE" });
  } catch {
    // Ignore cleanup errors so they do not mask the main swipe result.
  }
}

async function performWdaSwipe(
  port: number,
  deviceId: string,
  xStart: number,
  yStart: number,
  xEnd: number,
  yEnd: number,
  durationMs: number
): Promise<void> {
  await getVerifiedWdaDeviceIdForPort(port, deviceId);

  await withWdaSession(port, async (sessionUrl) => {
    try {
      const response = await fetch(`${sessionUrl}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actions: [
            {
              type: "pointer",
              id: "finger1",
              parameters: { pointerType: "touch" },
              actions: [
                { type: "pointerMove", duration: 0, x: xStart, y: yStart },
                { type: "pointerDown", button: 0 },
                { type: "pointerMove", duration: durationMs, x: xEnd, y: yEnd },
                { type: "pointerUp", button: 0 },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `WebDriverAgent actions request failed: ${response.status} ${await response.text()}`
        );
      }
    } finally {
      await clearWdaActions(sessionUrl);
    }
  });
}

async function performIdbSwipe(
  deviceId: string,
  xStart: number,
  yStart: number,
  xEnd: number,
  yEnd: number,
  durationSeconds: string,
  delta: number | undefined
): Promise<void> {
  const { stderr } = await idb(
    "ui",
    "swipe",
    "--udid",
    deviceId,
    "--duration",
    durationSeconds,
    ...(delta !== undefined ? ["--delta", String(delta)] : []),
    "--json",
    // When passing user-provided values to a command, it's crucial to use `--`
    // to separate the command's options from positional arguments.
    // This prevents the shell from misinterpreting the arguments as options.
    "--",
    String(xStart),
    String(yStart),
    String(xEnd),
    String(yEnd)
  );

  if (stderr) {
    throw new Error(stderr);
  }
}

async function launchAppOnSimulator(
  deviceId: string,
  bundleId: string,
  terminateRunning = false
): Promise<string> {
  const { stdout } = await run("xcrun", [
    "simctl",
    "launch",
    ...(terminateRunning ? ["--terminate-running-process"] : []),
    deviceId,
    bundleId,
  ]);

  return stdout;
}

async function restoreAppAfterWdaLaunch(
  deviceId: string,
  restoreAppBundleId: string
): Promise<string | null> {
  if (restoreAppBundleId === WDA_BUNDLE_ID) {
    return null;
  }

  await launchAppOnSimulator(deviceId, restoreAppBundleId);
  return restoreAppBundleId;
}

async function getOrAllocateWdaPort(deviceId: string): Promise<number> {
  return withWdaPortLock(async () => {
    const bootedDevices = await getBootedDevices();
    pruneWdaPorts(bootedDevices);
    const normalizedDeviceId = deviceId.toUpperCase();

    const existingPort = wdaPortsByDeviceId.get(deviceId);
    if (existingPort !== undefined) {
      if (await isPortAvailable(existingPort)) {
        return existingPort;
      }

      if (await isWdaRunning(existingPort)) {
        try {
          await getVerifiedWdaDeviceIdForPort(existingPort, normalizedDeviceId);
          return existingPort;
        } catch {
          removeWdaPortMappings(existingPort);
        }
      }

      wdaPortsByDeviceId.delete(deviceId);
    }

    const reservedPorts = new Set(wdaPortsByDeviceId.values());
    for (let offset = 0; offset < WDA_PORT_SEARCH_LIMIT; offset += 1) {
      const port = WDA_PORT_START + offset;
      if (reservedPorts.has(port)) {
        continue;
      }

      if (await isPortAvailable(port)) {
        wdaPortsByDeviceId.set(deviceId, port);
        return port;
      }
    }

    throw new Error(
      `Could not find an available WebDriverAgent port starting at ${WDA_PORT_START}`
    );
  });
}

async function getXcodeVersion(): Promise<string> {
  const { stdout } = await run("xcodebuild", ["-version"]);
  return stdout.replace(/\s+/g, "-");
}

async function isWdaBuildCached(): Promise<boolean> {
  try {
    await fs.promises.access(WDA_APP_PATH);
    const versionFile = path.join(WDA_CACHE_DIR, "xcode-version");
    const cachedVersion = await fs.promises
      .readFile(versionFile, "utf-8")
      .catch(() => "");
    const currentVersion = await getXcodeVersion();
    return cachedVersion.trim() === currentVersion;
  } catch {
    return false;
  }
}

async function cloneWdaRepo(): Promise<void> {
  if (
    await fs.promises
      .access(path.join(WDA_REPO_DIR, ".git"))
      .then(() => true)
      .catch(() => false)
  ) {
    await run("git", ["-C", WDA_REPO_DIR, "pull", "--ff-only"]);
    return;
  }

  await fs.promises.mkdir(WDA_CACHE_DIR, { recursive: true });
  await run("git", [
    "clone",
    "--depth",
    "1",
    "--single-branch",
    WDA_REPO_URL,
    WDA_REPO_DIR,
  ]);
}

async function buildWda(deviceId: string): Promise<void> {
  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(
      "xcodebuild",
      [
        "build-for-testing",
        "-quiet",
        "-project",
        path.join(WDA_REPO_DIR, "WebDriverAgent.xcodeproj"),
        "-scheme",
        "WebDriverAgentRunner",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `platform=iOS Simulator,id=${deviceId}`,
        "-derivedDataPath",
        WDA_DERIVED_DATA_DIR,
        "CODE_SIGNING_ALLOWED=NO",
        "CODE_SIGN_IDENTITY=",
        "CODE_SIGNING_REQUIRED=NO",
      ],
      {
        shell: false,
        timeout: WDA_BUILD_TIMEOUT_MS,
        maxBuffer: WDA_BUILD_MAX_BUFFER_BYTES,
      }
    );

    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    throw new Error(`Failed to build WebDriverAgent: ${describeCommandError(error)}`);
  }

  if (
    !(await fs.promises
      .access(WDA_APP_PATH)
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error(
      `xcodebuild succeeded but WDA app not found at ${WDA_APP_PATH}. stderr: ${stderr}`
    );
  }

  const currentVersion = await getXcodeVersion();
  await fs.promises.writeFile(
    path.join(WDA_CACHE_DIR, "xcode-version"),
    currentVersion
  );
}

async function installWdaOnSimulator(deviceId: string): Promise<void> {
  try {
    await run("xcrun", ["simctl", "install", deviceId, WDA_APP_PATH]);
  } catch (error) {
    throw new Error(
      `Failed to install WebDriverAgent on simulator ${deviceId}: ${describeCommandError(
        error
      )}`
    );
  }
}

async function ensureWdaInstalled(deviceId: string): Promise<void> {
  if (!(await isWdaBuildCached())) {
    try {
      await cloneWdaRepo();
    } catch (error) {
      throw new Error(
        `Failed to fetch WebDriverAgent sources: ${describeCommandError(error)}`
      );
    }

    await buildWda(deviceId);
  }

  await installWdaOnSimulator(deviceId);
}

async function launchWda(
  deviceId: string,
  port: number
): Promise<WdaLaunchResult> {
  try {
    await run(
      "xcrun",
      [
        "simctl",
        "launch",
        "--terminate-running-process",
        deviceId,
        WDA_BUNDLE_ID,
      ],
      {
        env: {
          ...process.env,
          SIMCTL_CHILD_USE_PORT: String(port),
        },
      }
    );
  } catch (error) {
    return {
      ok: false,
      reason: `simctl launch failed: ${describeCommandError(error)}`,
    };
  }

  const deadline = Date.now() + WDA_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isWdaRunning(port)) {
      return { ok: true };
    }

    await sleep(WDA_STATUS_POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    reason: `WebDriverAgent did not report ready on port ${port} within ${
      WDA_START_TIMEOUT_MS / 1000
    } seconds`,
  };
}

async function getWdaPortForSwipe(
  deviceId: string,
  restoreAppBundleId: string | undefined
): Promise<WdaPortForSwipeResult> {
  const port = await getOrAllocateWdaPort(deviceId);

  if (await isWdaRunning(port)) {
    try {
      await getVerifiedWdaDeviceIdForPort(port, deviceId);
      return { port };
    } catch (error) {
      removeWdaPortMappings(port);
      return {
        port: null,
        reason: `WebDriverAgent setup failed before swipe: ${describeCommandError(
          error
        )}`,
      };
    }
  }

  if (!restoreAppBundleId) {
    return {
      port: null,
      reason: `WebDriverAgent is not running on simulator ${deviceId}. Re-run ui_swipe with \`restore_app_bundle_id\` set to the exact app bundle identifier that should return to the foreground after WebDriverAgent launches.`,
    };
  }

  if (restoreAppBundleId === WDA_BUNDLE_ID) {
    return {
      port: null,
      reason: `The \`restore_app_bundle_id\` cannot be ${WDA_BUNDLE_ID}. Re-run ui_swipe with the app bundle identifier that should return to the foreground after WebDriverAgent launches.`,
    };
  }

  // Try launching WDA (it may already be installed)
  const initialLaunch = await launchWda(deviceId, port);
  if (initialLaunch.ok) {
    try {
      await getVerifiedWdaDeviceIdForPort(port, deviceId);
      await restoreAppAfterWdaLaunch(deviceId, restoreAppBundleId);
      return { port };
    } catch (error) {
      removeWdaPortMappings(port);
      return {
        port: null,
        reason: `WebDriverAgent launch succeeded, but setup after launch failed: ${describeCommandError(
          error
        )}`,
      };
    }
  }

  // WDA not installed — build from source and install
  try {
    await ensureWdaInstalled(deviceId);
  } catch (error) {
    return {
      port: null,
      reason: `WebDriverAgent was not ready on simulator ${deviceId}. Initial launch failed: ${
        initialLaunch.reason
      }. Automatic install also failed: ${describeCommandError(error)}`,
    };
  }

  // Retry launch after install
  const relaunch = await launchWda(deviceId, port);
  if (relaunch.ok) {
    try {
      await getVerifiedWdaDeviceIdForPort(port, deviceId);
      await restoreAppAfterWdaLaunch(deviceId, restoreAppBundleId);
      return { port };
    } catch (error) {
      removeWdaPortMappings(port);
      return {
        port: null,
        reason: `WebDriverAgent started after install, but setup after launch failed: ${describeCommandError(
          error
        )}`,
      };
    }
  }

  return {
    port: null,
    reason: `WebDriverAgent was installed on simulator ${deviceId}, but it still did not become ready. Initial launch failed: ${initialLaunch.reason}. Launch after install failed: ${relaunch.reason}`,
  };
}

// Register tools only if they're not filtered
if (!isToolFiltered("get_booted_sim_ids")) {
  server.tool(
    "get_booted_sim_ids",
    "Get the IDs and names of all currently booted iOS simulators",
    {
      title: "Get Booted Simulator IDs",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async () => {
      try {
        const bootedDevices = await getBootedDevices();

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(bootedDevices, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("open_simulator")) {
  server.tool(
    "open_simulator",
    "Opens the iOS Simulator application",
    { title: "Open Simulator", readOnlyHint: false, openWorldHint: true },
    async () => {
      try {
        await run("open", ["-a", "Simulator.app"]);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "Simulator.app opened successfully",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error opening Simulator.app: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_describe_all")) {
  server.tool(
    "ui_describe_all",
    "Describes accessibility information for the entire screen in the iOS Simulator",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
    },
    { title: "Describe All UI Elements", readOnlyHint: true, openWorldHint: true },
    async ({ udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout } = await idb(
          "ui",
          "describe-all",
          "--udid",
          actualUdid,
          "--json",
          "--nested"
        );

        return {
          isError: false,
          content: [{ type: "text", text: stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error describing all of the ui: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_tap")) {
  server.tool(
    "ui_tap",
    "Tap on the screen in the iOS Simulator",
    {
      duration: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional()
        .describe("Press duration"),
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      x: z.number().describe("The x-coordinate"),
      y: z.number().describe("The x-coordinate"),
    },
    { title: "UI Tap", readOnlyHint: false, openWorldHint: true },
    async ({ duration, udid, x, y }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stderr } = await idb(
          "ui",
          "tap",
          "--udid",
          actualUdid,
          ...(duration ? ["--duration", duration] : []),
          "--json",
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          String(x),
          String(y)
        );

        if (stderr) throw new Error(stderr);

        return {
          isError: false,
          content: [{ type: "text", text: "Tapped successfully" }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error tapping on the screen: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_type")) {
  server.tool(
    "ui_type",
    "Input text into the iOS Simulator",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      text: z
        .string()
        .max(500)
        .regex(/^[\x20-\x7E]+$/)
        .describe("Text to input"),
    },
    { title: "UI Type", readOnlyHint: false, openWorldHint: true },
    async ({ udid, text }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stderr } = await idb(
          "ui",
          "text",
          "--udid",
          actualUdid,
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          text
        );

        if (stderr) throw new Error(stderr);

        return {
          isError: false,
          content: [{ type: "text", text: "Typed successfully" }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error typing text into the iOS Simulator: ${
                  toError(error).message
                }`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_swipe")) {
  server.tool(
    "ui_swipe",
    "Swipe on the screen in the iOS Simulator",
    {
      duration: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional()
        .describe("Swipe duration in seconds (defaults to 1.0)"),
      enable_fallback: z
        .boolean()
        .optional()
        .describe(
          "Allow falling back to the legacy IDB swipe when WebDriverAgent is unavailable or fails (defaults to false)"
        ),
      restore_app_bundle_id: z
        .string()
        .max(256)
        .optional()
        .describe(
          "Required if WebDriverAgent must be launched; app bundle identifier to relaunch after WebDriverAgent starts so the tested app returns to the foreground"
        ),
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      x_start: z.number().describe("The starting x-coordinate"),
      y_start: z.number().describe("The starting y-coordinate"),
      x_end: z.number().describe("The ending x-coordinate"),
      y_end: z.number().describe("The ending y-coordinate"),
      delta: z
        .number()
        .optional()
        .describe(
          "Optional legacy IDB step size between touch points; requires enable_fallback=true"
        ),
    },
    { title: "UI Swipe", readOnlyHint: false, openWorldHint: true },
    async ({
      duration,
      enable_fallback,
      restore_app_bundle_id,
      udid,
      x_start,
      y_start,
      x_end,
      y_end,
      delta,
    }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);
        const fallbackEnabled = enable_fallback ?? false;
        const swipeDurationSeconds = getSwipeDurationSeconds(duration);
        const swipeDurationMs = getSwipeDurationMs(duration);

        if (delta !== undefined && !fallbackEnabled) {
          throw new Error(
            "The `delta` option only works with the legacy IDB swipe. Re-run with `enable_fallback=true` to use it."
          );
        }

        if (delta === undefined) {
          const wdaResult = await getWdaPortForSwipe(
            actualUdid,
            restore_app_bundle_id
          );

          if (wdaResult.port !== null) {
            try {
              await performWdaSwipe(
                wdaResult.port,
                actualUdid,
                x_start,
                y_start,
                x_end,
                y_end,
                swipeDurationMs
              );

              return {
                isError: false,
                content: [
                  {
                    type: "text",
                    text: `Swiped successfully using WebDriverAgent on simulator ${actualUdid} via port ${wdaResult.port}`,
                  },
                ],
              };
            } catch (error) {
              const detailedError = describeCommandError(error);

              if (!fallbackEnabled) {
                throw new Error(
                  `WebDriverAgent swipe failed: ${detailedError}. Re-run with \`enable_fallback=true\` to use the legacy IDB swipe.`
                );
              }

              await performIdbSwipe(
                actualUdid,
                x_start,
                y_start,
                x_end,
                y_end,
                swipeDurationSeconds,
                delta
              );

              return {
                isError: false,
                content: [
                  {
                    type: "text",
                    text: `Swiped successfully using the legacy IDB fallback after WebDriverAgent failed: ${detailedError}`,
                  },
                ],
              };
            }
          }

          if (!fallbackEnabled) {
            throw new Error(`${wdaResult.reason}. Re-run with \`enable_fallback=true\` to use the legacy IDB swipe.`);
          }

          await performIdbSwipe(
            actualUdid,
            x_start,
            y_start,
            x_end,
            y_end,
            swipeDurationSeconds,
            delta
          );

          return {
            isError: false,
            content: [
              {
                type: "text",
                text: `Swiped successfully using the legacy IDB fallback because WebDriverAgent was unavailable: ${wdaResult.reason}`,
              },
            ],
          };
        }

        await performIdbSwipe(
          actualUdid,
          x_start,
          y_start,
          x_end,
          y_end,
          swipeDurationSeconds,
          delta
        );

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "Swiped successfully using the legacy IDB fallback",
            },
          ],
        };
      } catch (error) {
        const detailedError = describeCommandError(error);
        const logPath = await writeTempLog(
          "ui-swipe-error",
          `Error swiping on the screen: ${detailedError}`
        );

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error swiping on the screen: ${summarizeErrorMessage(
                  detailedError
                )}. Full log written to: ${logPath}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_describe_point")) {
  server.tool(
    "ui_describe_point",
    "Returns the accessibility element at given co-ordinates on the iOS Simulator's screen",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      x: z.number().describe("The x-coordinate"),
      y: z.number().describe("The y-coordinate"),
    },
    { title: "Describe UI Point", readOnlyHint: true, openWorldHint: true },
    async ({ udid, x, y }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout, stderr } = await idb(
          "ui",
          "describe-point",
          "--udid",
          actualUdid,
          "--json",
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          String(x),
          String(y)
        );

        if (stderr) throw new Error(stderr);

        return {
          isError: false,
          content: [{ type: "text", text: stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error describing point (${x}, ${y}): ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_find_element")) {
  server.tool(
    "ui_find_element",
    "Searches the accessibility tree and returns elements matching the given criteria",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      search: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          "Array of search strings. An element matches if ANY string matches against its AXLabel or AXUniqueId"
        ),
      type: z
        .string()
        .optional()
        .describe(
          "Filter by element type (e.g. 'Button', 'StaticText', 'Group'). Case-insensitive exact match"
        ),
      matchMode: z
        .enum(["substring", "exact"])
        .optional()
        .default("substring")
        .describe("Match mode for search strings: 'substring' (default) or 'exact'"),
      caseSensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether search matching is case-sensitive (default: false)"),
    },
    { title: "Find UI Element", readOnlyHint: true, openWorldHint: true },
    async ({ search, type, matchMode, caseSensitive, udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout } = await idb(
          "ui",
          "describe-all",
          "--udid",
          actualUdid,
          "--json",
          "--nested"
        );

        const uiData = JSON.parse(stdout);

        function matchesSearch(
          value: string | null,
          term: string,
          mode: "substring" | "exact",
          sensitive: boolean
        ): boolean {
          if (value == null) return false;
          const v = sensitive ? value : value.toLowerCase();
          const t = sensitive ? term : term.toLowerCase();
          return mode === "exact" ? v === t : v.includes(t);
        }

        function findElements(
          elements: Array<Record<string, unknown>>
        ): Array<Record<string, unknown>> {
          const results: Array<Record<string, unknown>> = [];

          for (const element of elements) {
            const label = element.AXLabel as string | null;
            const uniqueId = element.AXUniqueId as string | null;
            const elementType = element.type as string | undefined;

            const matchesAnySearch = search.some(
              (term) =>
                matchesSearch(label, term, matchMode, caseSensitive) ||
                matchesSearch(uniqueId, term, matchMode, caseSensitive)
            );

            const matchesType =
              type == null ||
              (elementType != null &&
                elementType.toLowerCase() === type.toLowerCase());

            if (matchesAnySearch && matchesType) {
              results.push(element);
            }

            const children = element.children as
              | Array<Record<string, unknown>>
              | undefined;
            if (children && children.length > 0) {
              results.push(...findElements(children));
            }
          }

          return results;
        }

        const results = findElements(uiData);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(results),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error finding UI elements: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("ui_view")) {
  server.tool(
    "ui_view",
    "Get the image content of a compressed screenshot of the current simulator view",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
    },
    { title: "View Screenshot", readOnlyHint: true, openWorldHint: true },
    async ({ udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        // Get screen dimensions in points from ui_describe_all
        const { stdout: uiDescribeOutput } = await idb(
          "ui",
          "describe-all",
          "--udid",
          actualUdid,
          "--json",
          "--nested"
        );

        const uiData = JSON.parse(uiDescribeOutput);
        const screenFrame = uiData[0]?.frame;
        if (!screenFrame) {
          throw new Error("Could not determine screen dimensions");
        }

        const pointWidth = screenFrame.width;
        const pointHeight = screenFrame.height;

        // Generate unique file names with timestamp
        const ts = Date.now();
        const rawPng = path.join(TMP_ROOT_DIR, `ui-view-${ts}-raw.png`);
        const compressedJpg = path.join(
          TMP_ROOT_DIR,
          `ui-view-${ts}-compressed.jpg`
        );

        // Capture screenshot as PNG
        await run("xcrun", [
          "simctl",
          "io",
          actualUdid,
          "screenshot",
          "--type=png",
          "--",
          rawPng,
        ]);

        // Resize to match point dimensions and compress to JPEG using sips
        await run("sips", [
          "-z",
          String(pointHeight), // height in points
          String(pointWidth), // width in points
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          "80", // 80% quality
          rawPng,
          "--out",
          compressedJpg,
        ]);

        // Read and encode the compressed image
        const imageData = fs.readFileSync(compressedJpg);
        const base64Data = imageData.toString("base64");

        return {
          isError: false,
          content: [
            {
              type: "image",
              data: base64Data,
              mimeType: "image/jpeg",
            },
            {
              type: "text",
              text: "Screenshot captured",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error capturing screenshot: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

function ensureAbsolutePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Handle ~/something paths in the provided filePath
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  // Determine the default directory from env var or fallback to ~/Downloads
  let defaultDir = path.join(os.homedir(), "Downloads");
  const customDefaultDir = process.env.IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR;

  if (customDefaultDir) {
    // also expand tilde for the custom directory path
    if (customDefaultDir.startsWith("~/")) {
      defaultDir = path.join(os.homedir(), customDefaultDir.slice(2));
    } else {
      defaultDir = customDefaultDir;
    }
  }

  // Join the relative filePath with the resolved default directory
  return path.join(defaultDir, filePath);
}

if (!isToolFiltered("screenshot")) {
  server.tool(
    "screenshot",
    "Takes a screenshot of the iOS Simulator",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      output_path: z
        .string()
        .max(1024)
        .describe(
          "File path where the screenshot will be saved. If relative, it uses the directory specified by the `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` env var, or `~/Downloads` if not set."
        ),
      type: z
        .enum(["png", "tiff", "bmp", "gif", "jpeg"])
        .optional()
        .describe(
          "Image format (png, tiff, bmp, gif, or jpeg). Default is png."
        ),
      display: z
        .enum(["internal", "external"])
        .optional()
        .describe(
          "Display to capture (internal or external). Default depends on device type."
        ),
      mask: z
        .enum(["ignored", "alpha", "black"])
        .optional()
        .describe(
          "For non-rectangular displays, handle the mask by policy (ignored, alpha, or black)"
        ),
    },
    { title: "Take Screenshot", readOnlyHint: false, openWorldHint: true },
    async ({ udid, output_path, type, display, mask }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);
        const absolutePath = ensureAbsolutePath(output_path);

        // command is weird, it responds with stderr on success and stdout is blank
        const { stderr: stdout } = await run("xcrun", [
          "simctl",
          "io",
          actualUdid,
          "screenshot",
          ...(type ? [`--type=${type}`] : []),
          ...(display ? [`--display=${display}`] : []),
          ...(mask ? [`--mask=${mask}`] : []),
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          absolutePath,
        ]);

        // throw if we don't get the expected success message
        if (stdout && !stdout.includes("Wrote screenshot to")) {
          throw new Error(stdout);
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: stdout,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error taking screenshot: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("record_video")) {
  server.tool(
    "record_video",
    "Records a video of the iOS Simulator using simctl directly",
    {
      output_path: z
        .string()
        .max(1024)
        .optional()
        .describe(
          `Optional output path. If not provided, a default name will be used. The file will be saved in the directory specified by \`IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR\` or in \`~/Downloads\` if the environment variable is not set.`
        ),
      codec: z
        .enum(["h264", "hevc"])
        .optional()
        .describe(
          'Specifies the codec type: "h264" or "hevc". Default is "hevc".'
        ),
      display: z
        .enum(["internal", "external"])
        .optional()
        .describe(
          'Display to capture: "internal" or "external". Default depends on device type.'
        ),
      mask: z
        .enum(["ignored", "alpha", "black"])
        .optional()
        .describe(
          'For non-rectangular displays, handle the mask by policy: "ignored", "alpha", or "black".'
        ),
      force: z
        .boolean()
        .optional()
        .describe(
          "Force the output file to be written to, even if the file already exists."
        ),
    },
    { title: "Record Video", readOnlyHint: false, openWorldHint: true },
    async ({ output_path, codec, display, mask, force }) => {
      try {
        const defaultFileName = `simulator_recording_${Date.now()}.mp4`;
        const outputFile = ensureAbsolutePath(output_path ?? defaultFileName);

        // Start the recording process
        const recordingProcess = spawn("xcrun", [
          "simctl",
          "io",
          "booted",
          "recordVideo",
          ...(codec ? [`--codec=${codec}`] : []),
          ...(display ? [`--display=${display}`] : []),
          ...(mask ? [`--mask=${mask}`] : []),
          ...(force ? ["--force"] : []),
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          outputFile,
        ]);

        // Wait for recording to start
        await new Promise((resolve, reject) => {
          let errorOutput = "";

          recordingProcess.stderr.on("data", (data) => {
            const message = data.toString();
            if (message.includes("Recording started")) {
              resolve(true);
            } else {
              errorOutput += message;
            }
          });

          // Set timeout for start verification
          setTimeout(() => {
            if (recordingProcess.killed) {
              reject(new Error("Recording process terminated unexpectedly"));
            } else {
              resolve(true);
            }
          }, 3000);
        });

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Recording started. The video will be saved to: ${outputFile}\nTo stop recording, use the stop_recording command.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error starting recording: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("stop_recording")) {
  server.tool(
    "stop_recording",
    "Stops the simulator video recording using killall",
    {},
    { title: "Stop Recording", readOnlyHint: false, openWorldHint: true },
    async () => {
      try {
        await run("pkill", ["-SIGINT", "-f", "simctl.*recordVideo"]);

        // Wait a moment for the video to finalize
        await new Promise((resolve) => setTimeout(resolve, 1000));

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "Recording stopped successfully.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error stopping recording: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("install_app")) {
  server.tool(
    "install_app",
    "Installs an app bundle (.app or .ipa) on the iOS Simulator",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      app_path: z
        .string()
        .max(1024)
        .describe(
          "Path to the app bundle (.app directory or .ipa file) to install"
        ),
    },
    { title: "Install App", readOnlyHint: false, openWorldHint: true },
    async ({ udid, app_path }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);
        const absolutePath = path.isAbsolute(app_path)
          ? app_path
          : path.resolve(app_path);

        // Check if the app bundle exists
        if (!fs.existsSync(absolutePath)) {
          throw new Error(`App bundle not found at: ${absolutePath}`);
        }

        // run() will throw if the command fails (non-zero exit code)
        await run("xcrun", ["simctl", "install", actualUdid, absolutePath]);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `App installed successfully from: ${absolutePath}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error installing app: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("launch_app")) {
  server.tool(
    "launch_app",
    "Launches an app on the iOS Simulator by bundle identifier",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .optional()
        .describe("Udid of target, can also be set with the IDB_UDID env var"),
      bundle_id: z
        .string()
        .max(256)
        .describe(
          "Bundle identifier of the app to launch (e.g., com.apple.mobilesafari)"
        ),
      terminate_running: z
        .boolean()
        .optional()
        .describe(
          "Terminate the app if it is already running before launching"
        ),
    },
    { title: "Launch App", readOnlyHint: false, openWorldHint: true },
    async ({ udid, bundle_id, terminate_running }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const stdout = await launchAppOnSimulator(
          actualUdid,
          bundle_id,
          terminate_running
        );

        // Extract PID from output if available
        // simctl launch outputs the PID as the first token in stdout
        const pidMatch = stdout.match(/^(\d+)/);
        const pid = pidMatch ? pidMatch[1] : null;

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: pid
                ? `App ${bundle_id} launched successfully with PID: ${pid}`
                : `App ${bundle_id} launched successfully`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error launching app: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);

process.stdin.on("close", () => {
  console.log("iOS Simulator MCP Server closed");
  server.close();
  try {
    fs.rmSync(TMP_ROOT_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});
