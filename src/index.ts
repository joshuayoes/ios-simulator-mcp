#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
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
const SIMULATOR_PREFERENCES_PLIST = path.join(
  os.homedir(),
  "Library",
  "Preferences",
  "com.apple.iphonesimulator.plist"
);
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
const activeRecordingsByUdid = new Map<string, ActiveRecording>();
const recordingStartupReservationsByUdid = new Set<string>();
let wdaPortLock = Promise.resolve();
let swiftVideoRotationScriptPath: string | null = null;
const ERROR_SUMMARY_MAX_CHARS = 300;
const RECORDING_START_TIMEOUT_MS = 3000;
const RECORDING_STOP_FINALIZATION_TIMEOUT_MS = 3000;

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
  if (
    (toolName === "ui_swipe_wda" || toolName === "ui_swipe_legacy") &&
    FILTERED_TOOLS.includes("ui_swipe")
  ) {
    return true;
  }

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

type RotationAngle = -90 | 0 | 90 | 180;

type ActiveRecording = {
  outputFile: string;
  process: ChildProcessWithoutNullStreams;
  startRotationAngle: RotationAngle | null;
};

type BootedDeviceDetails = BootedDevice & {
  runtimeIdentifier: string;
};

type UiPoint = {
  x: number;
  y: number;
};

type UiFrame = UiPoint & {
  width: number;
  height: number;
};

type UiElement = {
  AXFrame?: string | null;
  children?: UiElement[];
  frame?: UiFrame;
  [key: string]: unknown;
};

type ScreenshotFormat = "png" | "tiff" | "bmp" | "gif" | "jpeg";

type ScreenshotOptions = {
  display?: "internal" | "external";
  mask?: "ignored" | "alpha" | "black";
  type?: ScreenshotFormat;
};

type PresentationTransform = {
  presentedHeight: number;
  presentedWidth: number;
  rawHeight: number;
  rawWidth: number;
  rotationAngle: RotationAngle;
};

type SimulatorDevicePreferences = {
  SimulatorWindowOrientation?: string;
  SimulatorWindowRotationAngle?: number;
};

type SimulatorHardwareButton = {
  position: [number, number];
  size: [number, number];
};

type SimulatorWindowOrientationSignal = {
  sleepWake: SimulatorHardwareButton | null;
  volumeDown: SimulatorHardwareButton | null;
  volumeUp: SimulatorHardwareButton | null;
  windowPosition: [number, number];
  windowSize: [number, number];
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

type OrientationProbe = {
  frame: UiFrame;
  label: string | null;
  point: UiPoint;
};

type VideoRotationMethod = "ffmpeg" | "swift";

type VideoRotationResult = {
  applied: boolean;
  method?: VideoRotationMethod;
  note?: string;
};

const ROTATION_ANGLE_CANDIDATES: RotationAngle[] = [0, 90, -90, 180];
const ORIENTATION_INFERENCE_PROBE_LIMIT = 8;
const ORIENTATION_INFERENCE_QUICK_PROBE_LIMIT = 3;
const presentationRotationCacheByDeviceId = new Map<
  string,
  { rotationAngle: RotationAngle; signature: string }
>();
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

async function getBootedDeviceDetails(
  deviceId: string
): Promise<BootedDeviceDetails> {
  const actualDeviceId = deviceId;
  const { stdout, stderr } = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "--json",
  ]);

  if (stderr) throw new Error(stderr);

  const devices = (JSON.parse(stdout) as SimctlListDevicesResponse).devices ?? {};
  for (const [runtimeIdentifier, runtimeDevices] of Object.entries(devices)) {
    for (const runtimeDevice of runtimeDevices) {
      if (
        runtimeDevice.udid === actualDeviceId &&
        typeof runtimeDevice.name === "string"
      ) {
        return {
          id: actualDeviceId,
          name: runtimeDevice.name,
          runtimeIdentifier,
        };
      }
    }
  }

  throw new Error(`Could not find simulator details for device ${actualDeviceId}`);
}

function isUiPoint(value: unknown): value is UiPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    typeof value.x === "number" &&
    "y" in value &&
    typeof value.y === "number"
  );
}

function isUiFrame(value: unknown): value is UiFrame {
  return (
    isUiPoint(value) &&
    "width" in value &&
    typeof value.width === "number" &&
    "height" in value &&
    typeof value.height === "number"
  );
}

function normalizeRotationAngle(
  rotationAngle: unknown,
  orientation: unknown
): RotationAngle {
  const numericAngle = Number(rotationAngle);
  if (Number.isFinite(numericAngle)) {
    const normalizedAngle = ((((0 - numericAngle) % 360) + 540) % 360) - 180;
    const roundedAngle = Math.round(normalizedAngle / 90) * 90;
    if (
      Math.abs(normalizedAngle - roundedAngle) < 0.0001 &&
      (roundedAngle === 0 ||
        roundedAngle === 90 ||
        roundedAngle === -90 ||
        roundedAngle === 180 ||
        roundedAngle === -180)
    ) {
      return roundedAngle === -180 ? 180 : (roundedAngle as RotationAngle);
    }
  }

  switch (orientation) {
    case "LandscapeLeft":
      return -90;
    case "LandscapeRight":
      return 90;
    case "PortraitUpsideDown":
      return 180;
    default:
      return 0;
  }
}

function formatSimulatorRuntimeTitle(runtimeIdentifier: string): string {
  const match = runtimeIdentifier.match(/SimRuntime\.([A-Za-z]+)-(.+)$/);
  if (!match) {
    return runtimeIdentifier;
  }

  return `${match[1]} ${match[2].replace(/-/g, ".")}`;
}

async function getSimulatorDevicePreferences(
  deviceId: string
): Promise<SimulatorDevicePreferences> {
  try {
    const { stdout } = await run("plutil", [
      "-extract",
      `DevicePreferences.${deviceId}`,
      "json",
      "-o",
      "-",
      SIMULATOR_PREFERENCES_PLIST,
    ]);
    return JSON.parse(stdout) as SimulatorDevicePreferences;
  } catch {
    return {};
  }
}

function getExpectedSimulatorWindowTitle(
  deviceDetails: BootedDeviceDetails
): string {
  return `${deviceDetails.name} \u2013 ${formatSimulatorRuntimeTitle(
    deviceDetails.runtimeIdentifier
  )}`;
}

async function getSimulatorWindowOrientationSignal(
  deviceId: string
): Promise<SimulatorWindowOrientationSignal | null> {
  try {
    const deviceDetails = await getBootedDeviceDetails(deviceId);
    const expectedTitle = getExpectedSimulatorWindowTitle(deviceDetails);
    const expectedNamePrefix = `${deviceDetails.name} \u2013 `;
    const jxaScript = `
const expectedTitle = ${JSON.stringify(expectedTitle)};
const expectedNamePrefix = ${JSON.stringify(expectedNamePrefix)};
const se = Application("System Events");
const proc = se.processes.byName("Simulator");

function findWindow() {
  const windows = proc.windows();
  for (const win of windows) {
    const name = win.name();
    if (name === expectedTitle) {
      return win;
    }
  }
  for (const win of windows) {
    const name = win.name();
    if (name.startsWith(expectedNamePrefix)) {
      return win;
    }
  }
  if (windows.length === 1) {
    return windows[0];
  }
  return null;
}

function maybeButton(win, names) {
  for (const name of names) {
    try {
      const button = win.buttons.byName(name);
      return {
        position: button.position(),
        size: button.size(),
      };
    } catch {}
  }
  return null;
}

const win = findWindow();
if (!win) {
  throw new Error("Simulator window not found");
}

console.log(JSON.stringify({
  windowPosition: win.position(),
  windowSize: win.size(),
  volumeUp: maybeButton(win, ["Volume Up"]),
  volumeDown: maybeButton(win, ["Volume Down"]),
  sleepWake: maybeButton(win, ["Sleep/Wake", "Side Button", "Action"]),
}));
`;

    const { stdout } = await run("osascript", [
      "-l",
      "JavaScript",
      "-e",
      jxaScript,
    ]);
    return JSON.parse(stdout) as SimulatorWindowOrientationSignal;
  } catch {
    return null;
  }
}

function getButtonCenter(button: SimulatorHardwareButton): UiPoint {
  return {
    x: button.position[0] + button.size[0] / 2,
    y: button.position[1] + button.size[1] / 2,
  };
}

function getRotationAngleFromWindowSignal(
  signal: SimulatorWindowOrientationSignal
): RotationAngle | null {
  if (!signal.volumeUp || !signal.volumeDown) {
    return null;
  }

  const [windowX, windowY] = signal.windowPosition;
  const [windowWidth, windowHeight] = signal.windowSize;
  const volumeUpCenter = getButtonCenter(signal.volumeUp);
  const volumeDownCenter = getButtonCenter(signal.volumeDown);
  const volumeDx = Math.abs(volumeUpCenter.x - volumeDownCenter.x);
  const volumeDy = Math.abs(volumeUpCenter.y - volumeDownCenter.y);
  const averageVolumeX =
    (volumeUpCenter.x + volumeDownCenter.x) / 2 - windowX;
  const averageVolumeY =
    (volumeUpCenter.y + volumeDownCenter.y) / 2 - windowY;

  if (volumeDy >= volumeDx) {
    return averageVolumeX >= windowWidth / 2 ? 0 : 180;
  }

  return averageVolumeY >= windowHeight / 2 ? 90 : -90;
}

async function getPresentedRotationAngle(deviceId: string): Promise<RotationAngle> {
  const signal = await getSimulatorWindowOrientationSignal(deviceId);
  const buttonDerivedRotation = signal
    ? getRotationAngleFromWindowSignal(signal)
    : null;

  if (buttonDerivedRotation !== null) {
    return buttonDerivedRotation;
  }

  const preferences = await getSimulatorDevicePreferences(deviceId);
  return normalizeRotationAngle(
    preferences.SimulatorWindowRotationAngle,
    preferences.SimulatorWindowOrientation
  );
}

function getUiRootFrame(uiData: UiElement[]): UiFrame {
  const rootFrame = uiData[0]?.frame;
  if (!isUiFrame(rootFrame)) {
    throw new Error("Could not determine screen dimensions");
  }
  return rootFrame;
}

async function getPresentedUiData(deviceId: string): Promise<UiElement[]> {
  const { stdout } = await idb(
    "ui",
    "describe-all",
    "--udid",
    deviceId,
    "--json",
    "--nested"
  );

  const uiData = JSON.parse(stdout);
  if (!Array.isArray(uiData) || uiData.length === 0) {
    throw new Error("Could not determine screen dimensions");
  }

  return uiData as UiElement[];
}

function createPresentationTransform(
  presentedRootFrame: UiFrame,
  rotationAngle: RotationAngle
): PresentationTransform {
  const isQuarterTurn = Math.abs(rotationAngle) === 90;

  return {
    rotationAngle,
    rawWidth: isQuarterTurn
      ? presentedRootFrame.height
      : presentedRootFrame.width,
    rawHeight: isQuarterTurn
      ? presentedRootFrame.width
      : presentedRootFrame.height,
    presentedWidth: presentedRootFrame.width,
    presentedHeight: presentedRootFrame.height,
  };
}

function pointInFrame(point: UiPoint, frame: UiFrame): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
}

function framesApproximatelyEqual(
  left: UiFrame,
  right: UiFrame,
  epsilon = 1
): boolean {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.width - right.width) <= epsilon &&
    Math.abs(left.height - right.height) <= epsilon
  );
}

function collectOrientationProbeElements(
  elements: UiElement[],
  rootFrame: UiFrame
): OrientationProbe[] {
  const probes: Array<OrientationProbe & { score: number }> = [];
  const rootArea = rootFrame.width * rootFrame.height;
  const rootCenterX = rootFrame.x + rootFrame.width / 2;
  const rootCenterY = rootFrame.y + rootFrame.height / 2;

  function visit(element: UiElement, isRoot = false): void {
    if (isUiFrame(element.frame)) {
      const area = element.frame.width * element.frame.height;
      if (
        !isRoot &&
        area > 0 &&
        area < rootArea * 0.9 &&
        element.frame.width > 4 &&
        element.frame.height > 4
      ) {
        const point = {
          x: element.frame.x + element.frame.width / 2,
          y: element.frame.y + element.frame.height / 2,
        };
        const normalizedDistanceFromCenter =
          Math.abs(point.x - rootCenterX) / Math.max(rootFrame.width, 1) +
          Math.abs(point.y - rootCenterY) / Math.max(rootFrame.height, 1);
        probes.push({
          frame: element.frame,
          label: typeof element.AXLabel === "string" ? element.AXLabel : null,
          point,
          score:
            normalizedDistanceFromCenter +
            1 / Math.sqrt(Math.max(area, 1)),
        });
      }
    }

    if (Array.isArray(element.children)) {
      for (const child of element.children) {
        visit(child);
      }
    }
  }

  elements.forEach((element, index) => visit(element, index === 0));

  return probes
    .sort(
      (left, right) => right.score - left.score
    )
    .filter((probe, index, allProbes) => {
      const roundedPoint = roundUiPoint(probe.point);
      return (
        allProbes.findIndex((candidate) => {
          const roundedCandidate = roundUiPoint(candidate.point);
          return (
            roundedCandidate.x === roundedPoint.x &&
            roundedCandidate.y === roundedPoint.y
          );
        }) === index
      );
    })
    .slice(0, ORIENTATION_INFERENCE_PROBE_LIMIT)
    .map(({ score: _score, ...probe }) => probe);
}

async function describeRawPoint(
  deviceId: string,
  rawPoint: UiPoint
): Promise<UiElement> {
  const { stdout, stderr } = await idb(
    "ui",
    "describe-point",
    "--udid",
    deviceId,
    "--json",
    "--",
    String(rawPoint.x),
    String(rawPoint.y)
  );

  if (stderr) {
    throw new Error(stderr);
  }

  return JSON.parse(stdout) as UiElement;
}

function getRotationAngleCandidatesForRootFrame(
  presentedRootFrame: UiFrame
): RotationAngle[] {
  if (presentedRootFrame.width > presentedRootFrame.height) {
    return [90, -90];
  }

  if (presentedRootFrame.height > presentedRootFrame.width) {
    return [0, 180];
  }

  return ROTATION_ANGLE_CANDIDATES;
}

function scoreProbeMatch(
  describedElement: UiElement,
  probe: OrientationProbe
): 0 | 1 | 2 {
  if (!isUiFrame(describedElement.frame)) {
    return 0;
  }

  if (framesApproximatelyEqual(describedElement.frame, probe.frame)) {
    return 2;
  }

  if (pointInFrame(probe.point, describedElement.frame)) {
    return 1;
  }

  return 0;
}

function getPresentationSignature(
  presentedRootFrame: UiFrame,
  probes: OrientationProbe[]
): string {
  return JSON.stringify({
    rootFrame: presentedRootFrame,
    probes: probes.slice(0, 3).map((probe) => ({
      frame: probe.frame,
      label: probe.label,
    })),
  });
}

async function inferRotationAngleFromUiQuick(
  deviceId: string,
  presentedRootFrame: UiFrame,
  probes: OrientationProbe[],
  rotationAngles: RotationAngle[]
): Promise<RotationAngle | null> {
  let remainingAngles = [...rotationAngles];

  for (const probe of probes.slice(0, ORIENTATION_INFERENCE_QUICK_PROBE_LIMIT)) {
    const candidateScores = await Promise.all(
      remainingAngles.map(async (rotationAngle) => {
        const transform = createPresentationTransform(
          presentedRootFrame,
          rotationAngle
        );
        const describedElement = await describeRawPoint(
          deviceId,
          roundUiPoint(transformPointToRaw(probe.point, transform))
        );

        return {
          rotationAngle,
          score: scoreProbeMatch(describedElement, probe),
        };
      })
    );

    const bestScore = Math.max(...candidateScores.map((candidate) => candidate.score));
    if (bestScore <= 0) {
      continue;
    }

    const bestAngles = candidateScores
      .filter((candidate) => candidate.score === bestScore)
      .map((candidate) => candidate.rotationAngle);

    if (bestAngles.length === 1) {
      return bestAngles[0];
    }

    remainingAngles = bestAngles;
  }

  return remainingAngles.length === 1 ? remainingAngles[0] : null;
}

async function inferRotationAngleFromUiExhaustive(
  deviceId: string,
  presentedRootFrame: UiFrame,
  probes: OrientationProbe[],
  rotationAngles: RotationAngle[]
): Promise<RotationAngle | null> {
  let bestRotation: RotationAngle | null = null;
  let bestScore = -1;
  let hasTie = false;

  for (const rotationAngle of rotationAngles) {
    const transform = createPresentationTransform(
      presentedRootFrame,
      rotationAngle
    );
    let score = 0;

    for (const probe of probes) {
      try {
        const describedElement = await describeRawPoint(
          deviceId,
          roundUiPoint(transformPointToRaw(probe.point, transform))
        );
        score += scoreProbeMatch(describedElement, probe);
      } catch {
        // Ignore individual probe failures and rely on the remaining probes.
      }
    }

    if (score > bestScore) {
      bestRotation = rotationAngle;
      bestScore = score;
      hasTie = false;
    } else if (score === bestScore) {
      hasTie = true;
    }
  }

  if (bestRotation === null || bestScore <= 0 || hasTie) {
    return null;
  }

  return bestRotation;
}

async function inferRotationAngleFromUi(
  deviceId: string,
  presentedRootFrame: UiFrame,
  probes: OrientationProbe[]
): Promise<RotationAngle | null> {
  if (probes.length === 0) {
    return null;
  }
  const candidateAngles = getRotationAngleCandidatesForRootFrame(
    presentedRootFrame
  );
  const cachedRotation =
    presentationRotationCacheByDeviceId.get(deviceId)?.rotationAngle;
  const orderedCandidateAngles =
    cachedRotation !== undefined && candidateAngles.includes(cachedRotation)
      ? [
          cachedRotation,
          ...candidateAngles.filter((rotationAngle) => rotationAngle !== cachedRotation),
        ]
      : candidateAngles;

  const quickRotation = await inferRotationAngleFromUiQuick(
    deviceId,
    presentedRootFrame,
    probes,
    orderedCandidateAngles
  );
  if (quickRotation !== null) {
    return quickRotation;
  }

  return inferRotationAngleFromUiExhaustive(
    deviceId,
    presentedRootFrame,
    probes,
    orderedCandidateAngles
  );
}

async function getPresentationTransform(
  deviceId: string,
  presentedUiData: UiElement[]
): Promise<PresentationTransform> {
  const presentedRootFrame = getUiRootFrame(presentedUiData);
  const probes = collectOrientationProbeElements(presentedUiData, presentedRootFrame);
  const signature = getPresentationSignature(presentedRootFrame, probes);
  const cachedEntry = presentationRotationCacheByDeviceId.get(deviceId);
  if (cachedEntry?.signature === signature) {
    return createPresentationTransform(
      presentedRootFrame,
      cachedEntry.rotationAngle
    );
  }

  const inferredRotation = probes.length
    ? await inferRotationAngleFromUi(deviceId, presentedRootFrame, probes)
    : null;
  const rotationAngle =
    inferredRotation ?? (await getPresentedRotationAngle(deviceId));

  presentationRotationCacheByDeviceId.set(deviceId, {
    rotationAngle,
    signature,
  });

  return createPresentationTransform(presentedRootFrame, rotationAngle);
}

async function getUiInteractionContext(deviceId: string): Promise<{
  presentedUiData: UiElement[];
  transform: PresentationTransform;
}> {
  const presentedUiData = await getPresentedUiData(deviceId);
  const transform = await getPresentationTransform(deviceId, presentedUiData);

  return {
    transform,
    presentedUiData,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function transformPointToRaw(
  point: UiPoint,
  transform: PresentationTransform
): UiPoint {
  switch (transform.rotationAngle) {
    case 90:
      return {
        x: clamp(point.y, 0, transform.rawWidth),
        y: clamp(transform.rawHeight - point.x, 0, transform.rawHeight),
      };
    case -90:
      return {
        x: clamp(transform.rawWidth - point.y, 0, transform.rawWidth),
        y: clamp(point.x, 0, transform.rawHeight),
      };
    case 180:
      return {
        x: clamp(transform.rawWidth - point.x, 0, transform.rawWidth),
        y: clamp(transform.rawHeight - point.y, 0, transform.rawHeight),
      };
    default:
      return {
        x: clamp(point.x, 0, transform.rawWidth),
        y: clamp(point.y, 0, transform.rawHeight),
      };
  }
}

function roundUiPoint(point: UiPoint): UiPoint {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function createTempFilePath(prefix: string, extension: string): string {
  return path.join(
    TMP_ROOT_DIR,
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  );
}

function createSiblingTempFilePath(filePath: string, label: string): string {
  const extension = path.extname(filePath);
  const baseName = extension ? path.basename(filePath, extension) : path.basename(filePath);

  return path.join(
    path.dirname(filePath),
    `${baseName}.${label}-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
  );
}

async function commandExists(commandName: string): Promise<boolean> {
  try {
    await run("which", [commandName]);
    return true;
  } catch {
    return false;
  }
}

function getFfmpegRotationFilter(rotationAngle: RotationAngle): string | null {
  switch (rotationAngle) {
    case 90:
      return "transpose=clock";
    case -90:
      return "transpose=cclock";
    case 180:
      return "hflip,vflip";
    default:
      return null;
  }
}

const SWIFT_VIDEO_ROTATION_SCRIPT = String.raw`import Foundation
import AVFoundation
import CoreGraphics

func usage() -> Never {
  fputs("usage: rotate-video.swift <input> <output> <angle>\n", stderr)
  exit(2)
}

guard CommandLine.arguments.count == 4 else { usage() }
let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let angle = Int(CommandLine.arguments[3]) else { usage() }

let asset = AVURLAsset(url: inputURL)
let composition = AVMutableComposition()

guard let videoTrack = asset.tracks(withMediaType: .video).first else {
  throw NSError(domain: "RotateVideo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing video track"])
}

guard let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
  throw NSError(domain: "RotateVideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create video track"])
}

let duration = asset.duration
try compositionVideoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoTrack, at: .zero)
compositionVideoTrack.preferredTransform = .identity

if let audioTrack = asset.tracks(withMediaType: .audio).first,
   let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
  try compositionAudioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: audioTrack, at: .zero)
}

let naturalSize = videoTrack.naturalSize
let videoComposition = AVMutableVideoComposition()
let nominalFrameRate = videoTrack.nominalFrameRate
videoComposition.frameDuration = nominalFrameRate > 0
  ? CMTime(value: 1, timescale: CMTimeScale(nominalFrameRate.rounded()))
  : CMTime(value: 1, timescale: 30)

let instruction = AVMutableVideoCompositionInstruction()
instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)

let transform: CGAffineTransform
switch angle {
case 90:
  videoComposition.renderSize = CGSize(width: naturalSize.height, height: naturalSize.width)
  transform = CGAffineTransform(translationX: naturalSize.height, y: 0).rotated(by: .pi / 2)
case -90:
  videoComposition.renderSize = CGSize(width: naturalSize.height, height: naturalSize.width)
  transform = CGAffineTransform(translationX: 0, y: naturalSize.width).rotated(by: -.pi / 2)
case 180:
  videoComposition.renderSize = CGSize(width: naturalSize.width, height: naturalSize.height)
  transform = CGAffineTransform(translationX: naturalSize.width, y: naturalSize.height).rotated(by: .pi)
case 0:
  videoComposition.renderSize = naturalSize
  transform = .identity
default:
  throw NSError(domain: "RotateVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unsupported angle \(angle)"])
}

layerInstruction.setTransform(transform, at: .zero)
instruction.layerInstructions = [layerInstruction]
videoComposition.instructions = [instruction]

if FileManager.default.fileExists(atPath: outputURL.path) {
  try FileManager.default.removeItem(at: outputURL)
}

guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
  throw NSError(domain: "RotateVideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not create export session"])
}
exportSession.outputURL = outputURL
exportSession.outputFileType = .mp4
exportSession.shouldOptimizeForNetworkUse = true
exportSession.videoComposition = videoComposition

let semaphore = DispatchSemaphore(value: 0)
var exportError: Error?
exportSession.exportAsynchronously {
  exportError = exportSession.error
  semaphore.signal()
}
semaphore.wait()

if let exportError {
  throw exportError
}
if exportSession.status != .completed {
  throw NSError(domain: "RotateVideo", code: 5, userInfo: [NSLocalizedDescriptionKey: "Export failed with status \(exportSession.status.rawValue)"])
}
`;

async function getSwiftVideoRotationScriptPath(): Promise<string> {
  if (swiftVideoRotationScriptPath) {
    return swiftVideoRotationScriptPath;
  }

  const scriptPath = createTempFilePath("rotate-video", "swift");
  await fs.promises.writeFile(scriptPath, SWIFT_VIDEO_ROTATION_SCRIPT, "utf8");
  swiftVideoRotationScriptPath = scriptPath;

  return scriptPath;
}

async function bakeVideoRotationWithFfmpeg(
  inputPath: string,
  outputPath: string,
  rotationAngle: RotationAngle
): Promise<void> {
  const filter = getFfmpegRotationFilter(rotationAngle);
  if (!filter) {
    await fs.promises.copyFile(inputPath, outputPath);
    return;
  }

  await run("ffmpeg", [
    "-y",
    "-nostdin",
    "-v",
    "error",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function bakeVideoRotationWithSwift(
  inputPath: string,
  outputPath: string,
  rotationAngle: RotationAngle
): Promise<void> {
  const scriptPath = await getSwiftVideoRotationScriptPath();
  await run("xcrun", [
    "swift",
    scriptPath,
    inputPath,
    outputPath,
    String(rotationAngle),
  ]);
}

async function replaceFileWithTempOutput(
  tempOutputPath: string,
  finalOutputPath: string
): Promise<void> {
  const backupPath = createSiblingTempFilePath(finalOutputPath, "backup");
  let originalMoved = false;

  try {
    await fs.promises.rename(finalOutputPath, backupPath);
    originalMoved = true;
    await fs.promises.rename(tempOutputPath, finalOutputPath);
    await fs.promises.unlink(backupPath).catch(() => {});
    originalMoved = false;
  } finally {
    await fs.promises.unlink(tempOutputPath).catch(() => {});

    if (originalMoved) {
      await fs.promises.rename(backupPath, finalOutputPath).catch(() => {});
      await fs.promises.unlink(backupPath).catch(() => {});
    }
  }
}

async function getRecordingStartRotationAngle(
  deviceId: string
): Promise<RotationAngle | null> {
  try {
    const { transform } = await getUiInteractionContext(deviceId);
    return transform.rotationAngle;
  } catch {
    return null;
  }
}

async function bakeRecordedVideoRotation(
  outputFile: string,
  startRotationAngle: RotationAngle | null
): Promise<VideoRotationResult> {
  if (startRotationAngle === null) {
    return {
      applied: false,
      note:
        "Rotation fix was skipped because the simulator orientation could not be determined when recording started.",
    };
  }

  if (startRotationAngle === 0) {
    return { applied: false };
  }

  const tempOutputPath = createSiblingTempFilePath(outputFile, "rotated");
  const ffmpegInstalled = await commandExists("ffmpeg");
  let ffmpegFailure: string | null = null;

  if (ffmpegInstalled) {
    try {
      await bakeVideoRotationWithFfmpeg(
        outputFile,
        tempOutputPath,
        startRotationAngle
      );
      await replaceFileWithTempOutput(tempOutputPath, outputFile);

      return {
        applied: true,
        method: "ffmpeg",
      };
    } catch (error) {
      ffmpegFailure = summarizeErrorMessage(describeCommandError(error));
      await fs.promises.unlink(tempOutputPath).catch(() => {});
    }
  }

  try {
    await bakeVideoRotationWithSwift(
      outputFile,
      tempOutputPath,
      startRotationAngle
    );
    await replaceFileWithTempOutput(tempOutputPath, outputFile);

    return {
      applied: true,
      method: "swift",
      note: ffmpegInstalled
        ? `Fell back to the built-in macOS video exporter after ffmpeg rotation failed: ${ffmpegFailure}.`
        : "Install ffmpeg to speed up baked video rotation on future recordings.",
    };
  } catch (error) {
    await fs.promises.unlink(tempOutputPath).catch(() => {});
    const swiftFailure = summarizeErrorMessage(describeCommandError(error));

    if (ffmpegInstalled && ffmpegFailure) {
      throw new Error(
        `Failed to bake video rotation with ffmpeg (${ffmpegFailure}) and with the built-in macOS fallback (${swiftFailure})`
      );
    }

    throw new Error(
      `Failed to bake video rotation with the built-in macOS fallback: ${swiftFailure}`
    );
  }
}

async function captureRawSimulatorScreenshot(
  deviceId: string,
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<void> {
  await run("xcrun", [
    "simctl",
    "io",
    deviceId,
    "screenshot",
    ...(options.type ? [`--type=${options.type}`] : []),
    ...(options.display ? [`--display=${options.display}`] : []),
    ...(options.mask ? [`--mask=${options.mask}`] : []),
    "--",
    outputPath,
  ]);
}

async function rotateImageInPlace(
  filePath: string,
  rotationAngle: RotationAngle
): Promise<void> {
  if (rotationAngle === 0) {
    return;
  }

  await run("sips", ["-r", String(rotationAngle), filePath]);
}

async function savePresentedScreenshot(
  deviceId: string,
  outputPath: string,
  transform: PresentationTransform,
  options: ScreenshotOptions = {}
): Promise<void> {
  const screenshotType = options.type ?? "png";
  const tempPath = createTempFilePath("screenshot", screenshotType);

  try {
    await captureRawSimulatorScreenshot(deviceId, tempPath, {
      ...options,
      type: screenshotType,
    });
    await rotateImageInPlace(tempPath, transform.rotationAngle);

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.copyFile(tempPath, outputPath);
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
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

async function getRawSwipePoints(
  udid: string,
  xStart: number,
  yStart: number,
  xEnd: number,
  yEnd: number
): Promise<{
  rawStartPoint: { x: number; y: number };
  rawEndPoint: { x: number; y: number };
}> {
  const { transform } = await getUiInteractionContext(udid);
  const rawStartPoint = roundUiPoint(
    transformPointToRaw({ x: xStart, y: yStart }, transform)
  );
  const rawEndPoint = roundUiPoint(
    transformPointToRaw({ x: xEnd, y: yEnd }, transform)
  );

  return { rawStartPoint, rawEndPoint };
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
      reason: `WebDriverAgent is not running on simulator ${deviceId}. Re-run with \`restore_app_bundle_id\` set to the exact app bundle identifier that should return to the foreground after WebDriverAgent launches.`,
    };
  }

  if (restoreAppBundleId === WDA_BUNDLE_ID) {
    return {
      port: null,
      reason: `The \`restore_app_bundle_id\` cannot be ${WDA_BUNDLE_ID}. Re-run with the app bundle identifier that should return to the foreground after WebDriverAgent launches.`,
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
        .describe("UDID of target simulator"),
    },
    { title: "Describe All UI Elements", readOnlyHint: true, openWorldHint: true },
    async ({ udid }) => {
      try {
        const presentedUiData = await getPresentedUiData(udid);

        return {
          isError: false,
          content: [{ type: "text", text: JSON.stringify(presentedUiData) }],
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
        .describe("UDID of target simulator"),
      x: z.number().describe("The x-coordinate"),
      y: z.number().describe("The x-coordinate"),
    },
    { title: "UI Tap", readOnlyHint: false, openWorldHint: true },
    async ({ duration, udid, x, y }) => {
      try {
        const { transform } = await getUiInteractionContext(udid);
        const rawPoint = roundUiPoint(
          transformPointToRaw({ x, y }, transform)
        );

        const { stderr } = await idb(
          "ui",
          "tap",
          "--udid",
          udid,
          ...(duration ? ["--duration", duration] : []),
          "--json",
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          String(rawPoint.x),
          String(rawPoint.y)
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
        .describe("UDID of target simulator"),
      text: z
        .string()
        .max(500)
        .regex(/^[\x20-\x7E]+$/)
        .describe("Text to input"),
    },
    { title: "UI Type", readOnlyHint: false, openWorldHint: true },
    async ({ udid, text }) => {
      try {
        const { stderr } = await idb(
          "ui",
          "text",
          "--udid",
          udid,
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

if (!isToolFiltered("ui_swipe_wda")) {
  server.tool(
    "ui_swipe_wda",
    "Swipe on the screen in the iOS Simulator using WebDriverAgent",
    {
      duration: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional()
        .describe("Swipe duration in seconds (defaults to 1.0)"),
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
        .describe("UDID of target simulator"),
      x_start: z.number().describe("The starting x-coordinate"),
      y_start: z.number().describe("The starting y-coordinate"),
      x_end: z.number().describe("The ending x-coordinate"),
      y_end: z.number().describe("The ending y-coordinate"),
    },
    { title: "UI Swipe (WDA)", readOnlyHint: false, openWorldHint: true },
    async ({
      duration,
      restore_app_bundle_id,
      udid,
      x_start,
      y_start,
      x_end,
      y_end,
    }) => {
      try {
        const swipeDurationMs = getSwipeDurationMs(duration);
        const { rawStartPoint, rawEndPoint } = await getRawSwipePoints(
          udid,
          x_start,
          y_start,
          x_end,
          y_end
        );
        const wdaResult = await getWdaPortForSwipe(udid, restore_app_bundle_id);

        if (wdaResult.port === null) {
          throw new Error(
            `${wdaResult.reason}. To explicitly use the legacy backend, call \`ui_swipe_legacy\`.`
          );
        }

        try {
          await performWdaSwipe(
            wdaResult.port,
            udid,
            rawStartPoint.x,
            rawStartPoint.y,
            rawEndPoint.x,
            rawEndPoint.y,
            swipeDurationMs
          );
        } catch (error) {
          throw new Error(
            `WebDriverAgent swipe failed: ${describeCommandError(
              error
            )}. To explicitly use the legacy backend, call \`ui_swipe_legacy\`.`
          );
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Swiped successfully using WebDriverAgent on simulator ${udid} via port ${wdaResult.port}`,
            },
          ],
        };
      } catch (error) {
        const detailedError = describeCommandError(error);
        const logPath = await writeTempLog(
          "ui-swipe-wda-error",
          `Error swiping on the screen with WebDriverAgent: ${detailedError}`
        );

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error swiping on the screen with WebDriverAgent: ${summarizeErrorMessage(
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

if (!isToolFiltered("ui_swipe_legacy")) {
  server.tool(
    "ui_swipe_legacy",
    "Swipe on the screen in the iOS Simulator using the legacy IDB backend",
    {
      duration: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional()
        .describe("Swipe duration in seconds (defaults to 1.0)"),
      udid: z
        .string()
        .regex(UDID_REGEX)
        .describe("UDID of target simulator"),
      x_start: z.number().describe("The starting x-coordinate"),
      y_start: z.number().describe("The starting y-coordinate"),
      x_end: z.number().describe("The ending x-coordinate"),
      y_end: z.number().describe("The ending y-coordinate"),
      delta: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Optional advanced legacy IDB step size in pixels between touch points"
        ),
    },
    { title: "UI Swipe (Legacy)", readOnlyHint: false, openWorldHint: true },
    async ({ duration, udid, x_start, y_start, x_end, y_end, delta }) => {
      try {
        const swipeDurationSeconds = getSwipeDurationSeconds(duration);
        const { rawStartPoint, rawEndPoint } = await getRawSwipePoints(
          udid,
          x_start,
          y_start,
          x_end,
          y_end
        );

        await performIdbSwipe(
          udid,
          rawStartPoint.x,
          rawStartPoint.y,
          rawEndPoint.x,
          rawEndPoint.y,
          swipeDurationSeconds,
          delta
        );

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Swiped successfully using legacy IDB on simulator ${udid}`,
            },
          ],
        };
      } catch (error) {
        const detailedError = describeCommandError(error);
        const logPath = await writeTempLog(
          "ui-swipe-legacy-error",
          `Error swiping on the screen with legacy IDB: ${detailedError}`
        );

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error swiping on the screen with legacy IDB: ${summarizeErrorMessage(
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
        .describe("UDID of target simulator"),
      x: z.number().describe("The x-coordinate"),
      y: z.number().describe("The y-coordinate"),
    },
    { title: "Describe UI Point", readOnlyHint: true, openWorldHint: true },
    async ({ udid, x, y }) => {
      try {
        const { transform } = await getUiInteractionContext(udid);
        const rawPoint = roundUiPoint(
          transformPointToRaw({ x, y }, transform)
        );

        const { stdout, stderr } = await idb(
          "ui",
          "describe-point",
          "--udid",
          udid,
          "--json",
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          String(rawPoint.x),
          String(rawPoint.y)
        );

        if (stderr) throw new Error(stderr);

        const element = JSON.parse(stdout) as UiElement;

        return {
          isError: false,
          content: [{ type: "text", text: JSON.stringify(element) }],
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
        .describe("UDID of target simulator"),
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
        const presentedUiData = await getPresentedUiData(udid);

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

        const results = findElements(presentedUiData);

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

if (!isToolFiltered("read_screen")) {
  server.tool(
    "read_screen",
    "Return the current simulator screen as an image for visual inspection. Use this when you need to understand or inspect what is currently on screen. If you need to save an image file to disk, use screenshot instead.",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .describe("UDID of target simulator"),
    },
    { title: "Read screen", readOnlyHint: true, openWorldHint: true },
    async ({ udid }) => {
      try {
        const { transform } = await getUiInteractionContext(udid);
        const pointWidth = transform.presentedWidth;
        const pointHeight = transform.presentedHeight;

        // Generate unique file names with timestamp
        const rawPng = createTempFilePath("ui-view-raw", "png");
        const compressedJpg = createTempFilePath("ui-view-compressed", "jpg");

        // Capture screenshot as PNG
        await captureRawSimulatorScreenshot(udid, rawPng, { type: "png" });
        await rotateImageInPlace(rawPng, transform.rotationAngle);

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

function isChildProcessFinished(
  childProcess: ChildProcessWithoutNullStreams
): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function clearTrackedRecording(
  udid: string,
  recordingProcess?: ChildProcessWithoutNullStreams
): void {
  if (
    !recordingProcess ||
    activeRecordingsByUdid.get(udid)?.process === recordingProcess
  ) {
    activeRecordingsByUdid.delete(udid);
  }

  recordingStartupReservationsByUdid.delete(udid);
}

function getTrackedRecording(
  udid: string
): ActiveRecording | null {
  const recording = activeRecordingsByUdid.get(udid);

  if (!recording) {
    return null;
  }

  if (isChildProcessFinished(recording.process)) {
    clearTrackedRecording(udid, recording.process);
    return null;
  }

  return recording;
}

function registerRecordingLifecycle(
  udid: string,
  recordingProcess: ChildProcessWithoutNullStreams
): void {
  const cleanup = () => {
    clearTrackedRecording(udid, recordingProcess);
  };

  recordingProcess.once("exit", cleanup);
  recordingProcess.once("error", cleanup);
}

async function waitForRecordingStartup(
  recordingProcess: ChildProcessWithoutNullStreams
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let errorOutput = "";

    const cleanup = () => {
      clearTimeout(timeout);
      recordingProcess.stderr.off("data", onStderr);
      recordingProcess.off("error", onError);
      recordingProcess.off("exit", onExit);
    };

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fn();
    };

    const onStderr = (data: Buffer) => {
      const message = data.toString();

      if (message.includes("Recording started")) {
        settle(() => resolve());
        return;
      }

      errorOutput += message;
    };

    const onError = (error: Error) => {
      settle(() => reject(new Error(errorOutput.trim() || error.message)));
    };

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null
    ) => {
      const reason =
        errorOutput.trim() ||
        `Recording process terminated unexpectedly${
          code !== null
            ? ` with exit code ${code}`
            : signal
              ? ` with signal ${signal}`
              : ""
        }`;

      settle(() => reject(new Error(reason)));
    };

    const timeout = setTimeout(() => {
      if (isChildProcessFinished(recordingProcess)) {
        onExit(recordingProcess.exitCode, recordingProcess.signalCode);
        return;
      }

      settle(() => resolve());
    }, RECORDING_START_TIMEOUT_MS);

    recordingProcess.stderr.on("data", onStderr);
    recordingProcess.once("error", onError);
    recordingProcess.once("exit", onExit);
  });
}

async function waitForRecordingToFinalize(
  recordingProcess: ChildProcessWithoutNullStreams
): Promise<void> {
  if (isChildProcessFinished(recordingProcess)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      recordingProcess.off("exit", onExit);
      recordingProcess.off("error", onError);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Recording process did not exit within ${RECORDING_STOP_FINALIZATION_TIMEOUT_MS}ms after SIGINT`
        )
      );
    }, RECORDING_STOP_FINALIZATION_TIMEOUT_MS);

    recordingProcess.once("exit", onExit);
    recordingProcess.once("error", onError);
  });
}

if (!isToolFiltered("screenshot")) {
  server.tool(
    "screenshot",
    "Save the current simulator screen to an image file on disk. Use this only when you need a persistent file or artifact. If you need to inspect the current screen, use read_screen instead.",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .describe("UDID of target simulator"),
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
    { title: "Save screenshot", readOnlyHint: false, openWorldHint: true },
    async ({ udid, output_path, type, display, mask }) => {
      try {
        const absolutePath = ensureAbsolutePath(output_path);
        const { transform } = await getUiInteractionContext(udid);
        await savePresentedScreenshot(udid, absolutePath, transform, {
          type,
          display,
          mask,
        });

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Wrote screenshot to ${absolutePath}`,
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
      udid: z
        .string()
        .regex(UDID_REGEX)
        .describe("UDID of target simulator"),
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
    async ({ udid, output_path, codec, display, mask, force }) => {
      let actualUdid: string | null = null;
      let recordingProcess: ChildProcessWithoutNullStreams | null = null;
      let outputFile: string | null = null;

      try {
        actualUdid = udid;

        if (
          getTrackedRecording(actualUdid) ||
          recordingStartupReservationsByUdid.has(actualUdid)
        ) {
          throw new Error(
            `A recording is already active or starting for simulator ${actualUdid} in this server instance`
          );
        }

        const defaultFileName = `simulator_recording_${Date.now()}.mp4`;
        outputFile = ensureAbsolutePath(output_path ?? defaultFileName);
        recordingStartupReservationsByUdid.add(actualUdid);
        const startRotationAnglePromise = getRecordingStartRotationAngle(
          actualUdid
        );

        recordingProcess = spawn("xcrun", [
          "simctl",
          "io",
          actualUdid,
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
        registerRecordingLifecycle(actualUdid, recordingProcess);

        await waitForRecordingStartup(recordingProcess);
        activeRecordingsByUdid.set(actualUdid, {
          outputFile,
          process: recordingProcess,
          startRotationAngle: await startRotationAnglePromise,
        });
        recordingStartupReservationsByUdid.delete(actualUdid);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Recording started for simulator ${actualUdid}. The video will be saved to: ${outputFile}\nTo stop recording, use stop_recording with the same udid: ${actualUdid}.`,
            },
          ],
        };
      } catch (error) {
        if (recordingProcess && !isChildProcessFinished(recordingProcess)) {
          recordingProcess.kill("SIGINT");
        }

        if (actualUdid) {
          clearTrackedRecording(actualUdid, recordingProcess ?? undefined);
        }

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
    "Stops a tracked simulator video recording for the targeted iOS Simulator",
    {
      udid: z
        .string()
        .regex(UDID_REGEX)
        .describe("UDID of target simulator"),
      fix_rotation: z
        .boolean()
        .optional()
        .describe(
          "Bake the saved video into the simulator's displayed orientation before returning. Defaults to true. Falls back to a slower built-in macOS exporter when ffmpeg is unavailable."
        ),
    },
    { title: "Stop Recording", readOnlyHint: false, openWorldHint: true },
    async ({ udid, fix_rotation }) => {
      let actualUdid: string | null = null;
      let recording: ActiveRecording | null = null;

      try {
        actualUdid = udid;
        recording = getTrackedRecording(actualUdid);

        if (!recording) {
          throw new Error(
            `No active recording is tracked for simulator ${actualUdid} in this server instance`
          );
        }

        const recordingProcess = recording.process;
        const signalSent = recordingProcess.kill("SIGINT");
        if (!signalSent && !isChildProcessFinished(recordingProcess)) {
          throw new Error(
            `Failed to send SIGINT to the recording process for simulator ${actualUdid}`
          );
        }

        try {
          await waitForRecordingToFinalize(recordingProcess);
        } finally {
          clearTrackedRecording(actualUdid, recordingProcess);
        }

        let text = `Recording stopped successfully for simulator ${actualUdid}. The video was saved to: ${recording.outputFile}`;

        if (fix_rotation !== false) {
          try {
            const rotationResult = await bakeRecordedVideoRotation(
              recording.outputFile,
              recording.startRotationAngle
            );

            if (rotationResult.applied) {
              text +=
                rotationResult.method === "ffmpeg"
                  ? "\nBaked rotation was applied automatically using ffmpeg."
                  : "\nBaked rotation was applied automatically using the built-in macOS video exporter.";
            }

            if (rotationResult.note) {
              text += `\n${rotationResult.note}`;
            }
          } catch (rotationError) {
            text += `\nRotation fix failed after the recording was saved: ${toError(rotationError).message}`;
          }
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text,
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
        .describe("UDID of target simulator"),
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
        const absolutePath = path.isAbsolute(app_path)
          ? app_path
          : path.resolve(app_path);

        // Check if the app bundle exists
        if (!fs.existsSync(absolutePath)) {
          throw new Error(`App bundle not found at: ${absolutePath}`);
        }

        // run() will throw if the command fails (non-zero exit code)
        await run("xcrun", ["simctl", "install", udid, absolutePath]);

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
        .describe("UDID of target simulator"),
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
        const stdout = await launchAppOnSimulator(
          udid,
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
