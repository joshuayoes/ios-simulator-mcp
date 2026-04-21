# iOS Simulator MCP Server

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=ios-simulator&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImlvcy1zaW11bGF0b3ItbWNwIl19) [![NPM Version](https://img.shields.io/npm/v/ios-simulator-mcp)](https://www.npmjs.com/package/ios-simulator-mcp)

A Model Context Protocol (MCP) server for interacting with iOS simulators. This server allows you to interact with iOS simulators by getting information about them, controlling UI interactions, and inspecting UI elements.

> **Security Notice**: Command injection vulnerabilities present in versions < 1.3.3 have been fixed. Please update to v1.3.3 or later. See [SECURITY.md](SECURITY.md) for details.

https://github.com/user-attachments/assets/453ebe7b-cc93-4ac2-b08d-0f8ac8339ad3

## 🌟 Featured In

This project has been featured and mentioned in various publications and resources:

- [Claude Code Best Practices article](https://www.anthropic.com/engineering/claude-code-best-practices#:~:text=Write%20code%2C%20screenshot%20result%2C%20iterate) - Anthropic's engineering blog showcasing best practices
- [React Native Newsletter Issue 187](https://us3.campaign-archive.com/?u=78d9e37a94fa0b522939163d4&id=656ed2c2cf#:~:text=iOS%20Simulator%20MCP%20Server) - Featured in the most popular React Native community newsletter
- [Mobile Automation Newsletter - #56](https://testableapple.com/newsletter/56/#:~:text=iOS-,iOS%20Simulator%20MCP,-%F0%9F%8E%99%EF%B8%8F%20Joshua%20Yoes) - Featured a long running newsletter about mobile testing and automation resources
- [punkeye/awesome-mcp-server listing](https://github.com/punkpeye/awesome-mcp-servers) - Listed in one of the most popular curated awesome MCP servers collection

## Tools

### `get_booted_sim_id`

**Description:** Get the ID of the currently booted iOS simulator

**Parameters:** No Parameters

### `open_simulator`

**Description:** Opens the iOS Simulator application

**Parameters:** No Parameters

### `ui_describe_all`

**Description:** Describes accessibility information for the entire screen in the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
}
```

### `ui_tap`

**Description:** Tap on the screen in the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Press duration in seconds (decimal numbers allowed)
   */
  duration?: string;
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** The x-coordinate */
  x: number;
  /** The y-coordinate */
  y: number;
}
```

### `ui_type`

**Description:** Input text into the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /**
   * Text to input
   * Format: ASCII printable characters only
   */
  text: string;
}
```

### `ui_swipe`

**Description:** Swipe on the screen in the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Swipe duration in seconds (decimal numbers allowed)
   */
  duration?: string;
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** The starting x-coordinate */
  x_start: number;
  /** The starting y-coordinate */
  y_start: number;
  /** The ending x-coordinate */
  x_end: number;
  /** The ending y-coordinate */
  y_end: number;
  /** The size of each step in the swipe (default is 1) */
  delta?: number;
}
```

### `ui_describe_point`

**Description:** Returns the accessibility element at given co-ordinates on the iOS Simulator's screen

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** The x-coordinate */
  x: number;
  /** The y-coordinate */
  y: number;
}
```

### `ui_view`

**Description:** Get the image content of a compressed screenshot of the current simulator view

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
}
```

### `screenshot`

**Description:** Takes a screenshot of the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** File path where the screenshot will be saved. If relative, it uses the directory specified by the `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` env var, or `~/Downloads` if not set. */
  output_path: string;
  /** Image format (png, tiff, bmp, gif, or jpeg). Default is png. */
  type?: "png" | "tiff" | "bmp" | "gif" | "jpeg";
  /** Display to capture (internal or external). Default depends on device type. */
  display?: "internal" | "external";
  /** For non-rectangular displays, handle the mask by policy (ignored, alpha, or black) */
  mask?: "ignored" | "alpha" | "black";
}
```

### `record_video`

**Description:** Records a video of the iOS Simulator using simctl directly

**Parameters:**

```typescript
{
  /** Optional output path. If not provided, a default name will be used. The file will be saved in the directory specified by `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` or in `~/Downloads` if the environment variable is not set. */
  output_path?: string;
  /** Specifies the codec type: "h264" or "hevc". Default is "hevc". */
  codec?: "h264" | "hevc";
  /** Display to capture: "internal" or "external". Default depends on device type. */
  display?: "internal" | "external";
  /** For non-rectangular displays, handle the mask by policy: "ignored", "alpha", or "black". */
  mask?: "ignored" | "alpha" | "black";
  /** Force the output file to be written to, even if the file already exists. */
  force?: boolean;
}
```

### `stop_recording`

**Description:** Stops the simulator video recording using killall

**Parameters:** No Parameters

### `install_app`

**Description:** Installs an app bundle (.app or .ipa) on the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** Path to the app bundle (.app directory or .ipa file) to install */
  app_path: string;
}
```

### `launch_app`

**Description:** Launches an app on the iOS Simulator by bundle identifier

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** Bundle identifier of the app to launch (e.g., com.apple.mobilesafari) */
  bundle_id: string;
  /** Terminate the app if it is already running before launching */
  terminate_running?: boolean;
}
```

### `terminate_app`

**Description:** Terminates a running app on the iOS Simulator by bundle identifier

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** Bundle identifier of the app to terminate (e.g., com.apple.mobilesafari) */
  bundle_id: string;
}
```

### `open_url`

**Description:** Opens a URL on the iOS Simulator (supports deep links and universal links)

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** The URL to open (e.g., https://example.com or myapp://deeplink) */
  url: string;
}
```

### `list_apps`

**Description:** Lists all installed apps on the iOS Simulator

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
}
```

### `ui_paste`

**Description:** Pastes text into the focused text field using clipboard injection. Supports emoji, Unicode, CJK characters, and any text that cannot be typed via keyboard simulation.

**Parameters:**

```typescript
{
  /**
   * Udid of target, can also be set with the IDB_UDID env var
   * Format: UUID (8-4-4-4-12 hexadecimal characters)
   */
  udid?: string;
  /** Text to paste (supports emoji, Unicode, and all character sets) */
  text: string;
}
```

### `rotate_device`

**Description:** Rotates the iOS Simulator left (counter-clockwise) or right (clockwise)

**Parameters:**

```typescript
{
  /** Direction to rotate: "left" is counter-clockwise, "right" is clockwise */
  direction: "left" | "right";
  /** Number of 90° increments to rotate (1–3). Defaults to 1. */
  times?: number;
}
```

## 💡 Use Cases

This MCP server lets your AI assistant see, interact with, and validate your iOS app directly in the simulator — no manual clicking required. Below are real workflows you can hand off to your AI agent.

---

### 🎥 Record a Bug Reproduction

When filing a bug report or reviewing a PR, have your agent reproduce the steps on video:

```
Start recording the simulator screen, then follow the reproduction steps from this PR description:
1. Open the Settings tab
2. Toggle "Enable notifications" off and back on
3. Background the app and reopen it
4. Confirm the toggle state persisted

Stop the recording when done and save it to ~/Desktop/bug-repro.mp4
```

The agent will start recording, navigate through each step using `ui_tap` and `ui_describe_all`, stop the recording, and hand you a ready-to-attach video.

---

### ✅ Validate a Feature After Implementation

After your static checks pass, have your agent navigate to the new feature and sanity-check it visually:

```
I just implemented the new onboarding flow. After the build finishes,
open the app, navigate to the onboarding screen, go through each step,
and take a screenshot of the final state. Tell me if anything looks off.
```

The agent will install the fresh build, walk through the UI, and report back with a screenshot — catching layout issues and broken navigation before you even switch windows.

---

### 🐛 Fix a React Native Redbox Error

When a Redbox pops up mid-development, point your agent at it:

```
Look at the current simulator screen. There's a React Native error — read it,
find the root cause in the source code, apply a fix, rebuild, then view the
simulator again to confirm the error is gone.
```

The agent reads the error via `ui_view`, traces it to the source, fixes it, triggers a rebuild, and verifies the screen is clean — all without you leaving your editor.

---

### 🌐 Test Unicode and Emoji Input

Standard keyboard injection can't handle emoji or non-ASCII characters. This server uses clipboard injection so your agent can type anything:

```
Open the chat composer, type "Hello 🌍! こんにちは", and take a screenshot
to confirm the text rendered correctly.
```

Works with emoji, CJK characters, Arabic, RTL text — anything on the clipboard.

---

### 📱 Test Landscape and Portrait Layouts

Have your agent check your layout in both orientations:

```
Rotate the simulator to landscape, take a screenshot, then rotate back to portrait
and take another. Compare both and flag any elements that are clipped or overlapping.
```

---

### 🔁 Full QA Session

Chain the tools together for a complete smoke test after a build:

```
Install the latest build from DerivedData, launch the app, and run through
the critical path:
1. Log in with test@example.com / password123
2. Navigate to the Profile tab
3. Edit the display name to "QA Bot 🤖"
4. Save and confirm the name updated on screen
5. Take a final screenshot and save it to ~/Desktop/qa-pass.png
```

## Prerequisites

- Node.js
- macOS (as iOS simulators are only available on macOS)
- [Xcode](https://developer.apple.com/xcode/resources/) and iOS simulators installed
- Facebook [IDB](https://fbidb.io/) tool [(see install guide)](https://fbidb.io/docs/installation)

## Installation

This section provides instructions for integrating the iOS Simulator MCP server with different Model Context Protocol (MCP) clients.

### Installation with Cursor

Cursor manages MCP servers through its configuration file located at `~/.cursor/mcp.json`.

#### Option 1: Using NPX (Recommended)

1.  Edit your Cursor MCP configuration file. You can often open it directly from Cursor or use a command like:
    ```bash
    # Open with your default editor (or use 'code', 'vim', etc.)
    open ~/.cursor/mcp.json
    # Or use Cursor's command if available
    # cursor ~/.cursor/mcp.json
    ```
2.  Add or update the `mcpServers` section with the iOS simulator server configuration:
    ```json
    {
      "mcpServers": {
        // ... other servers might be listed here ...
        "ios-simulator": {
          "command": "npx",
          "args": ["-y", "ios-simulator-mcp"]
        }
      }
    }
    ```
    Ensure the JSON structure is valid, especially if `mcpServers` already exists.
3.  Restart Cursor for the changes to take effect.

#### Option 2: Local Development

1.  Clone this repository:
    ```bash
    git clone https://github.com/joshuayoes/ios-simulator-mcp
    cd ios-simulator-mcp
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the project:
    ```bash
    npm run build
    ```
4.  Edit your Cursor MCP configuration file (as shown in Option 1).
5.  Add or update the `mcpServers` section, pointing to your local build:
    ```json
    {
      "mcpServers": {
        // ... other servers might be listed here ...
        "ios-simulator": {
          "command": "node",
          "args": ["/full/path/to/your/ios-simulator-mcp/build/index.js"]
        }
      }
    }
    ```
    **Important:** Replace `/full/path/to/your/` with the absolute path to where you cloned the `ios-simulator-mcp` repository.
6.  Restart Cursor for the changes to take effect.

### Installation with Claude Code

Claude Code CLI can manage MCP servers using the `claude mcp` commands or by editing its configuration files directly. For more details on Claude Code MCP configuration, refer to the [official documentation](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/tutorials#set-up-model-context-protocol-mcp).

#### Option 1: Using NPX (Recommended)

1.  Add the server using the `claude mcp add` command:
    ```bash
    claude mcp add ios-simulator npx ios-simulator-mcp
    ```
2.  Restart any running Claude Code sessions if necessary.

#### Option 2: Local Development

1.  Clone this repository, install dependencies, and build the project as described in the Cursor "Local Development" steps 1-3.
2.  Add the server using the `claude mcp add` command, pointing to your local build:
    ```bash
    claude mcp add ios-simulator -- node "/full/path/to/your/ios-simulator-mcp/build/index.js"
    ```
    **Important:** Replace `/full/path/to/your/` with the absolute path to where you cloned the `ios-simulator-mcp` repository.
3.  Restart any running Claude Code sessions if necessary.

## Configuration

### Environment Variables

| Variable                               | Description                                                                                                                                                                                          | Example                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `IOS_SIMULATOR_MCP_FILTERED_TOOLS`     | A comma-separated list of tool names to filter out from being registered.                                                                                                                            | `screenshot,record_video,stop_recording` |
| `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` | Specifies a default directory for output files like screenshots and video recordings. If not set, `~/Downloads` will be used. This can be handy if your agent has limited access to the file system. | `~/Code/awesome-project/tmp`             |
| `IOS_SIMULATOR_MCP_IDB_PATH`           | Specifies a custom path to the IDB executable. If not set, `idb` will be used (assuming it's in your PATH). Useful if IDB is installed in a non-standard location.                                   | `~/bin/idb` or `/usr/local/bin/idb`      |

#### Configuration Example

```json
{
  "mcpServers": {
    "ios-simulator": {
      "command": "npx",
      "args": ["-y", "ios-simulator-mcp"],
      "env": {
        "IOS_SIMULATOR_MCP_FILTERED_TOOLS": "screenshot,record_video,stop_recording",
        "IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR": "~/Code/awesome-project/tmp",
        "IOS_SIMULATOR_MCP_IDB_PATH": "~/bin/idb"
      }
    }
  }
}
```

## MCP Registry Server Listings

<a href="https://glama.ai/mcp/servers/@joshuayoes/ios-simulator-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@joshuayoes/ios-simulator-mcp/badge" alt="iOS Simulator MCP server" />
</a>

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/joshuayoes-ios-simulator-mcp-badge.png)](https://mseep.ai/app/joshuayoes-ios-simulator-mcp)

## License

MIT
