#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import path from "path";
import os from "os";
import fs from "fs";

type LaunchArgsInput = {
  udid: string;
  bundleId: string;
  terminateRunning?: boolean;
  env?: Record<string, string>;
};

type LaunchArgsOutput = {
  args: string[];
  env: Record<string, string>;
};

export function buildLaunchArgs({
  udid,
  bundleId,
  terminateRunning,
  env,
}: LaunchArgsInput): LaunchArgsOutput {
  const args: string[] = ["launch"];

  if (terminateRunning) {
    args.push("--terminate-running-process");
  }

  const simctlEnv: Record<string, string> = {};

  if (env) {
    const entries = Object.entries(env)
      .map(([key, value]) => [key.trim(), value] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of entries) {
      if (!key) {
        throw new Error("Environment variable keys must be non-empty.");
      }
      simctlEnv[`SIMCTL_CHILD_${key}`] = value;
    }
  }

  args.push(udid, bundleId);
  return { args, env: simctlEnv };
}

const execFileAsync = promisify(execFile);

/**
 * Strict UDID/UUID pattern: 8-4-4-4-12 hexadecimal characters (e.g. 37A360EC-75F9-4AEC-8EFA-10F4A58D8CCA)
 */
const UDID_REGEX =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

const TMP_ROOT_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "ios-simulator-mcp-"),
);

/**
 * Runs a command with arguments and returns the stdout and stderr
 * @param cmd - The command to run
 * @param args - The arguments to pass to the command
 * @returns The stdout and stderr of the command
 */
type RunOptions = {
  env?: Record<string, string>;
  /** Data piped to the child's stdin (e.g. feeding one command's output into another without a shell) */
  input?: string;
};

async function run(
  cmd: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const mergedEnv = options.env
    ? { ...process.env, ...options.env }
    : process.env;
  const promise = execFileAsync(cmd, args, {
    shell: false,
    env: mergedEnv,
  });
  if (options.input !== undefined && promise.child.stdin) {
    // Tolerate EPIPE if the child exits before draining stdin; the promise
    // still rejects on non-zero exit, so failures are not silenced.
    promise.child.stdin.on("error", () => {});
    promise.child.stdin.end(options.input);
  }
  const { stdout, stderr } = await promise;
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
        `Custom IDB path specified in IOS_SIMULATOR_MCP_IDB_PATH does not exist: ${expandedPath}`,
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
    tool.trim(),
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

function troubleshootingLink(): string {
  return "[Troubleshooting Guide](https://github.com/joshuayoes/ios-simulator-mcp/blob/main/TROUBLESHOOTING.md) | [Plain Text Guide for LLMs](https://raw.githubusercontent.com/joshuayoes/ios-simulator-mcp/refs/heads/main/TROUBLESHOOTING.md)";
}

function errorWithTroubleshooting(message: string): string {
  return `${message}\n\nFor help, see the ${troubleshootingLink()}`;
}

async function getBootedDevice() {
  const { stdout, stderr } = await run("xcrun", ["simctl", "list", "devices"]);

  if (stderr) throw new Error(stderr);

  // Parse the output to find booted device
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (line.includes("Booted")) {
      // Extract the UUID - it's inside parentheses
      const match = line.match(/\(([-0-9A-F]+)\)/);
      if (match) {
        const deviceId = match[1];
        const deviceName = line.split("(")[0].trim();
        return {
          name: deviceName,
          id: deviceId,
        };
      }
    }
  }

  throw Error("No booted simulator found");
}

async function getBootedDeviceId(
  deviceId: string | undefined,
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

// Register tools only if they're not filtered
if (!isToolFiltered("get_booted_sim_id")) {
  server.registerTool(
    "get_booted_sim_id",
    {
      description: "Get the ID of the currently booted iOS simulator",
      annotations: {
        title: "Get Booted Simulator ID",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { id, name } = await getBootedDevice();

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Booted Simulator: "${name}". UUID: "${id}"`,
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
                `Error: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("open_simulator")) {
  server.registerTool(
    "open_simulator",
    {
      description: "Opens the iOS Simulator application",
      annotations: {
        title: "Open Simulator",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
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
                `Error opening Simulator.app: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_describe_all")) {
  server.registerTool(
    "ui_describe_all",
    {
      description:
        "Describes accessibility information for the entire screen in the iOS Simulator",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
      }),
      annotations: {
        title: "Describe All UI Elements",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout } = await idb(
          "ui",
          "describe-all",
          "--udid",
          actualUdid,
          "--json",
          "--nested",
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
                `Error describing all of the ui: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_tap")) {
  server.registerTool(
    "ui_tap",
    {
      description: "Tap on the screen in the iOS Simulator",
      inputSchema: z.object({
        duration: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe("Press duration"),
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        x: z.number().describe("The x-coordinate"),
        y: z.number().describe("The x-coordinate"),
      }),
      annotations: {
        title: "UI Tap",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
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
          String(y),
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
                `Error tapping on the screen: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

type AXElement = {
  type?: string;
  AXLabel?: string | null;
  AXValue?: string | null;
  traits?: string[];
  frame?: { x: number; y: number; width: number; height: number };
};

const HID_KEYCODE_V = "25";
const HID_KEYCODE_DELETE = "42";
const HID_KEYCODE_SPACE = "44";
const HID_KEYCODE_DOWN_ARROW = "81";
const HID_KEYCODE_UP_ARROW = "82";

const PASTE_TIMEOUT_MS = 3000;

// Without a UTF-8 locale, simctl pbcopy/pbpaste treat text as Mac Roman.
const SIMCTL_PASTEBOARD_ENV = { LC_ALL: "en_US.UTF-8" };

/** Button labels of the "Allow Paste" choice in iOS's paste permission prompt. */
const ALLOW_PASTE_LABELS = ["Allow Paste", "Autoriser le collage"];

/** Runs an idb command that needs a recent fb-idb, with an upgrade hint for older ones. */
async function idbForPaste(...args: string[]) {
  try {
    return await idb(...args);
  } catch (error) {
    const { message } = toError(error);
    if (/unrecognized arguments|invalid choice/.test(message)) {
      throw new Error(
        `idb is too old for method "paste": upgrade to fb-idb 1.5.1+ (\`uv tool install --python 3.12 fb-idb@latest\`) or use method "type". ${message}`,
      );
    }
    throw error;
  }
}

/** Presses a key; modifiers (e.g. "--command") need a recent fb-idb. */
async function pressKey(udid: string, code: string, ...modifiers: string[]) {
  const args = ["ui", "key", "--udid", udid, ...modifiers, "--", code];
  return modifiers.length ? idbForPaste(...args) : idb(...args);
}

/** Sets the simulator clipboard text. */
const pbcopy = (udid: string, text: string) =>
  run("xcrun", ["simctl", "pbcopy", udid], {
    input: text,
    env: SIMCTL_PASTEBOARD_ENV,
  });

/** axbridge sees fields the default reader misses (e.g. web content); IsEditing marks focus. */
async function describeForTyping(udid: string): Promise<AXElement[]> {
  const keys = ["type", "AXLabel", "AXValue", "traits", "frame"];
  const { stdout } = await idbForPaste(
    "ui",
    "describe-all",
    "--udid",
    udid,
    "--json",
    "--api",
    "axbridge",
    ...keys.flatMap((key) => ["--key", key]),
  );
  return JSON.parse(stdout);
}

function focusedField(elements: AXElement[]): AXElement | undefined {
  return elements.find((e) => e.traits?.includes("IsEditing"));
}

/** Secure text fields report one bullet per character instead of their text. */
function isSecureValue(value: string): boolean {
  return /^•+$/.test(value);
}

async function readFocusedField(udid: string): Promise<AXElement> {
  const field = focusedField(await describeForTyping(udid));
  if (!field) {
    throw new Error(
      'No focused text field found: tap it first, or use method "type". If it is focused, idb_companion is too old (`brew upgrade idb-companion`, then `idb kill` so the old companion stops serving the simulator).',
    );
  }
  return field;
}

/** Clears the focused field with Cmd+Down, Shift+Cmd+Up and Delete, which (unlike Cmd+A) work on any layout. */
async function clearFocusedField(udid: string) {
  // idb returns before the app handles the keys (WebKit takes seconds for long text), so wait
  // until two reads agree.
  const settledValue = async (keys: number) => {
    const deadline = Date.now() + Math.min(1000 + keys * 50, 5000);
    let value = (await readFocusedField(udid)).AXValue ?? "";
    for (;;) {
      const next = (await readFocusedField(udid)).AXValue ?? "";
      if (next === value || Date.now() >= deadline) return next;
      value = next;
    }
  };
  let value = (await readFocusedField(udid)).AXValue ?? "";
  if (!value) return;
  await pressKey(udid, HID_KEYCODE_DOWN_ARROW, "--command");
  // Selecting back to the start lets one Delete clear even long text.
  await pressKey(udid, HID_KEYCODE_UP_ARROW, "--shift", "--command");
  // Delete presses can be dropped: repeat while the value shrinks to a prefix (not a placeholder).
  for (let round = 0, deletes = 1; round < 5; round++) {
    const presses = Array<string>(deletes).fill(HID_KEYCODE_DELETE);
    await idb("ui", "key-sequence", "--udid", udid, "--", ...presses);
    const left = await settledValue(deletes);
    if (!left) return;
    const shrank = left !== value && value.startsWith(left);
    value = left;
    if (!shrank) break;
    deletes = value.length;
  }
  // An empty field reports its placeholder, so check that a typed space becomes the whole value.
  await pressKey(udid, HID_KEYCODE_SPACE);
  const probe = await settledValue(1);
  if (probe !== value) {
    await pressKey(udid, HID_KEYCODE_DELETE);
    // Wait for the Delete, so the paste doesn't take the field's change for its own.
    await settledValue(1);
  }
  // Secure fields show the space as a single bullet.
  if (probe !== " " && !(isSecureValue(probe) && probe.length === 1)) {
    throw new Error(
      `Could not clear the focused field, so nothing was pasted. It contains ${JSON.stringify(value.slice(0, 200))}.`,
    );
  }
}

/**
 * Finds the allow button of iOS's "<App> would like to paste from CoreSimulatorBridge" prompt:
 * undefined when no prompt is shown, null when its button isn't recognized.
 */
function findAllowPasteButton(
  elements: AXElement[],
): AXElement | null | undefined {
  const prompt = elements.find(
    (e) =>
      e.type === "StaticText" && e.AXLabel?.includes("CoreSimulatorBridge"),
  );
  if (!prompt?.frame) return undefined;
  const promptY = prompt.frame.y;
  const buttons = elements.filter(
    (e) =>
      e.type === "Button" &&
      e.AXLabel &&
      e.frame &&
      e.frame.y > promptY &&
      e.frame.y < promptY + 300,
  );
  const known = buttons.find((b) => ALLOW_PASTE_LABELS.includes(b.AXLabel!));
  if (known) return known;
  if (buttons.length !== 2) return null;
  // Button order differs between iOS versions, but the deny label is the allow
  // label plus a negation ("Einsetzen nicht erlauben"), so only trust that shape.
  const [allow, deny] = [...buttons].sort(
    (a, b) => a.AXLabel!.length - b.AXLabel!.length,
  );
  const allowWords = allow.AXLabel!.toLowerCase().split(/\s+/);
  const denyLabel = deny.AXLabel!.toLowerCase();
  const isNegation = allowWords.every((word) => denyLabel.includes(word));
  return allow.AXLabel!.length < deny.AXLabel!.length && isNegation
    ? allow
    : null;
}

/** The paste may still happen later, so the clipboard must keep the text. */
class PastePendingError extends Error {}

const pastePending = (status: string, button: string) =>
  new PastePendingError(
    `iOS asks to allow pasting from CoreSimulatorBridge${status}. Tap ${button} to finish pasting (the clipboard still holds the text) instead of calling ui_type again.`,
  );

/** Waits until the pasted text shows up in the focused field, tapping "Allow Paste" if asked. */
async function confirmPaste(
  udid: string,
  before: string,
  text: string,
  warnings: string[],
  exact: boolean,
) {
  let taps = 0;
  let lastTap = 0;
  let deadline = Date.now() + PASTE_TIMEOUT_MS;
  // The read started after the deadline is the final one.
  for (let finalRead = false; !finalRead;) {
    finalRead = Date.now() >= deadline;
    const elements = await describeForTyping(udid);
    const allow = findAllowPasteButton(elements);
    if (allow === null) {
      throw pastePending(", but its allow button wasn't recognized", "it");
    }
    // A tap made while the prompt is still appearing is sometimes ignored.
    if (allow?.frame) {
      if (Date.now() - lastTap < 1000) continue;
      const button = `"${allow.AXLabel}"`;
      if (taps === 3 || finalRead) {
        const tapped = taps
          ? ` (still showing after ${taps} tap${taps > 1 ? "s" : ""} on ${button})`
          : "";
        throw pastePending(tapped, button);
      }
      const f = allow.frame;
      const center = [f.x + f.width / 2, f.y + f.height / 2].map(Math.round);
      await idb("ui", "tap", "--udid", udid, "--", ...center.map(String));
      taps++;
      lastTap = Date.now();
      deadline = lastTap + PASTE_TIMEOUT_MS;
      continue;
    }
    const field = focusedField(elements);
    if (!field) continue;
    const after = field.AXValue ?? "";
    if (after === before) continue;
    if (isSecureValue(after)) {
      // An empty field reports its placeholder, so it had no bullets yet; a refocused
      // secure field may also replace its content instead of appending.
      const added = after.length - (isSecureValue(before) ? before.length : 0);
      const expected = [...text].length;
      if (added !== expected && after.length !== expected) {
        warnings.push(
          `The secure field gained ${added} characters instead of ${expected} (the app may have filtered them).`,
        );
      }
    } else if (exact ? after !== text : !after.includes(text)) {
      warnings.push(
        `The field changed but doesn't contain exactly the typed text (the app may have reformatted it): ${JSON.stringify(after.slice(0, 200))}`,
      );
    }
    return;
  }
  throw new Error(
    text === before
      ? "Cmd+V did not visibly change the focused text field, but the text equals its placeholder, so it may have been pasted: check the field before retrying."
      : "Cmd+V did not change the focused text field. The field may not allow pasting.",
  );
}

/**
 * Pastes via the simulator pasteboard and Cmd+V, which unlike `idb ui text` works on any keyboard
 * layout, then restores the previous pasteboard text.
 */
async function pasteText(
  udid: string,
  text: string,
  replace: boolean,
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    let field = await readFocusedField(udid);
    if (field.traits?.includes("ReadOnly"))
      throw new Error("The focused field is read-only, so nothing was pasted.");
    if (replace) {
      await clearFocusedField(udid);
      field = await readFocusedField(udid);
    }
    // Not `run`, which trims: the pasteboard is restored byte for byte.
    const { stdout: previous } = await execFileAsync(
      "xcrun",
      ["simctl", "pbpaste", udid],
      { env: { ...process.env, ...SIMCTL_PASTEBOARD_ENV } },
    );
    await pbcopy(udid, text);
    let restoreClipboard = true;
    try {
      await pressKey(udid, HID_KEYCODE_V, "--command");
      await confirmPaste(udid, field.AXValue ?? "", text, warnings, replace);
    } catch (error) {
      // Restoring now could let a late Allow tap paste the old clipboard.
      if (error instanceof PastePendingError) restoreClipboard = false;
      throw error;
    } finally {
      if (restoreClipboard)
        await pbcopy(udid, previous).catch((error) =>
          warnings.push(
            `Could not restore the simulator clipboard, which now holds the typed text: ${toError(error).message}`,
          ),
        );
    }
  } catch (error) {
    const failure = toError(error);
    if (warnings.length > 0)
      failure.message += ` Warning: ${warnings.join(" ")}`;
    throw failure;
  }
  return warnings;
}

if (!isToolFiltered("ui_type")) {
  server.registerTool(
    "ui_type",
    {
      description: "Input text into the iOS Simulator",
      inputSchema: z
        .object({
          udid: z
            .string()
            .regex(UDID_REGEX)
            .optional()
            .describe(
              "Udid of target, can also be set with the IDB_UDID env var",
            ),
          text: z.string().max(500).describe("Text to input"),
          method: z
            .enum(["type", "paste"])
            .default("type")
            .describe(
              '"type" (default): presses keys as on a US keyboard; printable ASCII only. "paste": use when the keyboard layout is not US (e.g. AZERTY, where "type" types wrong characters) or the text is non-ASCII; pastes into the focused field (tap it first), ~3 s',
            ),
          replace: z
            .boolean()
            .default(false)
            .describe(
              'Paste only: clear the focused field first, e.g. after "type" produced wrong characters',
            ),
        })
        .superRefine(({ text, method, replace }, ctx) => {
          if (replace && method === "type") {
            ctx.addIssue({
              code: "custom",
              path: ["replace"],
              message: 'replace only works with method "paste"',
            });
          }
          const valid = method === "type" ? /^[\x20-\x7E]+$/ : /^[^\r\n]+$/;
          if (!valid.test(text)) {
            ctx.addIssue({
              code: "custom",
              path: ["text"],
              message:
                method === "type"
                  ? 'Must be printable ASCII without newlines; use method "paste" for other text or non-US keyboard layouts'
                  : "Must be non-empty, without newlines",
            });
          }
        }),
      annotations: {
        title: "UI Type",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ udid, text, method, replace }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        if (method === "paste") {
          const warnings = await pasteText(actualUdid, text, replace);
          return {
            isError: false,
            content: [
              {
                type: "text",
                text: [
                  "Typed successfully",
                  ...warnings.map((w) => `Warning: ${w}`),
                ].join("\n"),
              },
            ],
          };
        }

        const { stderr } = await idb(
          "ui",
          "text",
          "--udid",
          actualUdid,
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          text,
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
                }`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_swipe")) {
  server.registerTool(
    "ui_swipe",
    {
      description: "Swipe on the screen in the iOS Simulator",
      inputSchema: z.object({
        duration: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe("Swipe duration in seconds (e.g., 0.1)"),
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        x_start: z.number().describe("The starting x-coordinate"),
        y_start: z.number().describe("The starting y-coordinate"),
        x_end: z.number().describe("The ending x-coordinate"),
        y_end: z.number().describe("The ending y-coordinate"),
        delta: z
          .number()
          .optional()
          .describe("The size of each step in the swipe (default is 1)")
          .default(1),
      }),
      annotations: {
        title: "UI Swipe",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ duration, udid, x_start, y_start, x_end, y_end, delta }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stderr } = await idb(
          "ui",
          "swipe",
          "--udid",
          actualUdid,
          ...(duration ? ["--duration", duration] : []),
          ...(delta ? ["--delta", String(delta)] : []),
          "--json",
          // When passing user-provided values to a command, it's crucial to use `--`
          // to separate the command's options from positional arguments.
          // This prevents the shell from misinterpreting the arguments as options.
          "--",
          String(x_start),
          String(y_start),
          String(x_end),
          String(y_end),
        );

        if (stderr) throw new Error(stderr);

        return {
          isError: false,
          content: [{ type: "text", text: "Swiped successfully" }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: errorWithTroubleshooting(
                `Error swiping on the screen: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_describe_point")) {
  server.registerTool(
    "ui_describe_point",
    {
      description:
        "Returns the accessibility element at given co-ordinates on the iOS Simulator's screen",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        x: z.number().describe("The x-coordinate"),
        y: z.number().describe("The y-coordinate"),
      }),
      annotations: {
        title: "Describe UI Point",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
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
          String(y),
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
                `Error describing point (${x}, ${y}): ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_find_element")) {
  server.registerTool(
    "ui_find_element",
    {
      description:
        "Searches the accessibility tree and returns elements matching the given criteria",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        search: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            "Array of search strings. An element matches if ANY string matches against its AXLabel or AXUniqueId",
          ),
        type: z
          .string()
          .optional()
          .describe(
            "Filter by element type (e.g. 'Button', 'StaticText', 'Group'). Case-insensitive exact match",
          ),
        matchMode: z
          .enum(["substring", "exact"])
          .optional()
          .default("substring")
          .describe(
            "Match mode for search strings: 'substring' (default) or 'exact'",
          ),
        caseSensitive: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Whether search matching is case-sensitive (default: false)",
          ),
      }),
      annotations: {
        title: "Find UI Element",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ search, type, matchMode, caseSensitive, udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout } = await idb(
          "ui",
          "describe-all",
          "--udid",
          actualUdid,
          "--json",
          "--nested",
        );

        const uiData = JSON.parse(stdout);

        function matchesSearch(
          value: string | null,
          term: string,
          mode: "substring" | "exact",
          sensitive: boolean,
        ): boolean {
          if (value == null) return false;
          const v = sensitive ? value : value.toLowerCase();
          const t = sensitive ? term : term.toLowerCase();
          return mode === "exact" ? v === t : v.includes(t);
        }

        function findElements(
          elements: Array<Record<string, unknown>>,
        ): Array<Record<string, unknown>> {
          const results: Array<Record<string, unknown>> = [];

          for (const element of elements) {
            const label = element.AXLabel as string | null;
            const uniqueId = element.AXUniqueId as string | null;
            const elementType = element.type as string | undefined;

            const matchesAnySearch = search.some(
              (term) =>
                matchesSearch(label, term, matchMode, caseSensitive) ||
                matchesSearch(uniqueId, term, matchMode, caseSensitive),
            );

            const matchesType =
              type == null ||
              (elementType != null &&
                elementType.toLowerCase() === type.toLowerCase());

            if (matchesAnySearch && matchesType) {
              results.push(element);
            }

            const children = element.children as
              Array<Record<string, unknown>> | undefined;
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
                `Error finding UI elements: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("ui_view")) {
  server.registerTool(
    "ui_view",
    {
      description:
        "Get the image content of a compressed screenshot of the current simulator view",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
      }),
      annotations: {
        title: "View Screenshot",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
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
          "--nested",
        );

        let uiData: unknown;
        try {
          uiData = JSON.parse(uiDescribeOutput);
        } catch {
          throw new Error(
            "Failed to parse screen dimensions: idb returned invalid JSON",
          );
        }
        const screenFrame = (
          uiData as Array<{ frame?: { width: unknown; height: unknown } }>
        )[0]?.frame;
        if (
          !screenFrame ||
          typeof screenFrame.width !== "number" ||
          typeof screenFrame.height !== "number" ||
          screenFrame.width <= 0 ||
          screenFrame.height <= 0
        ) {
          throw new Error(
            "Could not determine valid screen dimensions from idb output",
          );
        }

        const pointWidth = screenFrame.width;
        const pointHeight = screenFrame.height;

        // Generate unique file names with timestamp + random suffix to avoid collisions
        const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rawPng = path.join(TMP_ROOT_DIR, `ui-view-${ts}-raw.png`);
        const compressedJpg = path.join(
          TMP_ROOT_DIR,
          `ui-view-${ts}-compressed.jpg`,
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

        // Read and encode the compressed image, then clean up temp files immediately
        const imageData = fs.readFileSync(compressedJpg);
        const base64Data = imageData.toString("base64");
        try {
          fs.unlinkSync(rawPng);
          fs.unlinkSync(compressedJpg);
        } catch {
          // ignore cleanup errors — they'll be removed on server exit
        }

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
                `Error capturing screenshot: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
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
  server.registerTool(
    "screenshot",
    {
      description: "Takes a screenshot of the iOS Simulator",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        output_path: z
          .string()
          .max(1024)
          .describe(
            "File path where the screenshot will be saved. If relative, it uses the directory specified by the `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` env var, or `~/Downloads` if not set.",
          ),
        type: z
          .enum(["png", "tiff", "bmp", "gif", "jpeg"])
          .optional()
          .describe(
            "Image format (png, tiff, bmp, gif, or jpeg). Default is png.",
          ),
        display: z
          .enum(["internal", "external"])
          .optional()
          .describe(
            "Display to capture (internal or external). Default depends on device type.",
          ),
        mask: z
          .enum(["ignored", "alpha", "black"])
          .optional()
          .describe(
            "For non-rectangular displays, handle the mask by policy (ignored, alpha, or black)",
          ),
      }),
      annotations: {
        title: "Take Screenshot",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
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
                `Error taking screenshot: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("record_video")) {
  server.registerTool(
    "record_video",
    {
      description: "Records a video of the iOS Simulator using simctl directly",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        output_path: z
          .string()
          .max(1024)
          .optional()
          .describe(
            `Optional output path. If not provided, a default name will be used. The file will be saved in the directory specified by \`IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR\` or in \`~/Downloads\` if the environment variable is not set.`,
          ),
        codec: z
          .enum(["h264", "hevc"])
          .optional()
          .describe(
            'Specifies the codec type: "h264" or "hevc". Default is "hevc".',
          ),
        display: z
          .enum(["internal", "external"])
          .optional()
          .describe(
            'Display to capture: "internal" or "external". Default depends on device type.',
          ),
        mask: z
          .enum(["ignored", "alpha", "black"])
          .optional()
          .describe(
            'For non-rectangular displays, handle the mask by policy: "ignored", "alpha", or "black".',
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Force the output file to be written to, even if the file already exists.",
          ),
      }),
      annotations: {
        title: "Record Video",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ udid, output_path, codec, display, mask, force }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);
        const defaultFileName = `simulator_recording_${Date.now()}.mp4`;
        const outputFile = ensureAbsolutePath(output_path ?? defaultFileName);

        // Start the recording process
        const recordingProcess = spawn("xcrun", [
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

        // Wait for recording to start or fail within 5 seconds
        await new Promise((resolve, reject) => {
          let errorOutput = "";
          let resolved = false;

          recordingProcess.stderr.on("data", (data) => {
            const message = data.toString();
            if (message.includes("Recording started")) {
              resolved = true;
              resolve(true);
            } else {
              errorOutput += message;
            }
          });

          recordingProcess.on("exit", (code) => {
            if (!resolved) {
              reject(
                new Error(
                  errorOutput.trim() ||
                    `Recording process exited early with code ${code}`,
                ),
              );
            }
          });

          setTimeout(() => {
            if (!resolved) {
              if (
                recordingProcess.killed ||
                recordingProcess.exitCode !== null
              ) {
                reject(
                  new Error(
                    errorOutput.trim() ||
                      "Recording process terminated unexpectedly",
                  ),
                );
              } else {
                // Process still running but no "Recording started" message — assume it started
                resolve(true);
              }
            }
          }, 5000);
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
                `Error starting recording: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("stop_recording")) {
  server.registerTool(
    "stop_recording",
    {
      description: "Stops the simulator video recording using killall",
      inputSchema: z.object({}),
      annotations: {
        title: "Stop Recording",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
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
                `Error stopping recording: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("install_app")) {
  server.registerTool(
    "install_app",
    {
      description: "Installs an app bundle (.app or .ipa) on the iOS Simulator",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        app_path: z
          .string()
          .max(1024)
          .describe(
            "Path to the app bundle (.app directory or .ipa file) to install",
          ),
      }),
      annotations: {
        title: "Install App",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
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
                `Error installing app: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("launch_app")) {
  server.registerTool(
    "launch_app",
    {
      description: "Launches an app on the iOS Simulator by bundle identifier",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        bundle_id: z
          .string()
          .max(256)
          .describe(
            "Bundle identifier of the app to launch (e.g., com.apple.mobilesafari)",
          ),
        terminate_running: z
          .boolean()
          .optional()
          .describe(
            "Terminate the app if it is already running before launching",
          ),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables to pass to simctl launch"),
      }),
      annotations: {
        title: "Launch App",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ udid, bundle_id, terminate_running, env }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { args, env: simctlEnv } = buildLaunchArgs({
          udid: actualUdid,
          bundleId: bundle_id,
          terminateRunning: terminate_running,
          env,
        });

        // run() will throw if the command fails (non-zero exit code)
        const { stdout } = await run("xcrun", ["simctl", ...args], {
          env: simctlEnv,
        });

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
                `Error launching app: ${toError(error).message}`,
              ),
            },
          ],
        };
      }
    },
  );
}

if (!isToolFiltered("terminate_app")) {
  server.registerTool(
    "terminate_app",
    {
      description:
        "Terminates a running app on the iOS Simulator by bundle identifier",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        bundle_id: z
          .string()
          .max(256)
          .describe(
            "Bundle identifier of the app to terminate (e.g., com.apple.mobilesafari)",
          ),
      }),
      annotations: {
        title: "Terminate App",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ udid, bundle_id }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        // `simctl terminate` rejects a `--` separator (usage error). Flag
        // parsing stops at the positional device argument, so passing the
        // bundle id directly cannot be interpreted as an option.
        await run("xcrun", ["simctl", "terminate", actualUdid, bundle_id]);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `App ${bundle_id} terminated successfully`,
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
                `Error terminating app: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("open_url")) {
  server.registerTool(
    "open_url",
    {
      description:
        "Opens a URL in the iOS Simulator, useful for testing deep links and universal links",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
        url: z
          .string()
          .max(2048)
          .describe(
            "The URL or deep link to open (e.g., https://example.com or myapp://screen/detail)",
          ),
      }),
      annotations: {
        title: "Open URL",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ udid, url }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        // `simctl openurl` treats `--` itself as the URL operand ("failed to
        // open --"). Flag parsing stops at the positional device argument, so
        // passing the url directly cannot be interpreted as an option.
        await run("xcrun", ["simctl", "openurl", actualUdid, url]);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Opened URL: ${url}`,
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
                `Error opening URL: ${toError(error).message}`
              ),
            },
          ],
        };
      }
    }
  );
}

if (!isToolFiltered("list_apps")) {
  server.registerTool(
    "list_apps",
    {
      description:
        "Lists all installed apps on the iOS Simulator with their bundle identifiers and display names",
      inputSchema: z.object({
        udid: z
          .string()
          .regex(UDID_REGEX)
          .optional()
          .describe(
            "Udid of target, can also be set with the IDB_UDID env var",
          ),
      }),
      annotations: {
        title: "List Installed Apps",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ udid }) => {
      try {
        const actualUdid = await getBootedDeviceId(udid);

        const { stdout: plistText } = await run("xcrun", [
          "simctl",
          "listapps",
          actualUdid,
        ]);

        // `simctl listapps` emits NeXTSTEP-style plist text that varies in
        // whitespace across Xcode versions. Delegate parsing to `plutil` which
        // converts it to JSON regardless of formatting quirks.
        const { stdout: jsonText } = await run(
          "plutil",
          ["-convert", "json", "-o", "-", "--", "-"],
          { input: plistText },
        );

        const rawApps = JSON.parse(jsonText) as Record<
          string,
          { CFBundleDisplayName?: string; CFBundleName?: string }
        >;

        const apps = Object.entries(rawApps)
          .map(([bundleId, info]) => ({
            bundleId,
            name: info.CFBundleDisplayName ?? info.CFBundleName ?? bundleId,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        const appList = apps
          .map((a) => `${a.name} — ${a.bundleId}`)
          .join("\n");

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: appList || "No apps found",
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
                `Error listing apps: ${toError(error).message}`
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
  console.error("iOS Simulator MCP Server closed");
  server.close();
  try {
    fs.rmSync(TMP_ROOT_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});
