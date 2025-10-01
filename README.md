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

## 💡 Use Case: QA Step via MCP Tool Calls

This MCP server allows AI assistants integrated with a Model Context Protocol (MCP) client to perform Quality Assurance tasks by making tool calls. This is useful immediately after implementing features to help ensure UI consistency and correct behavior.

### How to Use

After a feature implementation, instruct your AI assistant within its MCP client environment to use the available tools. For example, in Cursor's agent mode, you could use the prompts below to quickly validate and document UI interactions.

### Example Prompts

- **Verify UI Elements:**

  ```
  Verify all accessibility elements on the current screen
  ```

- **Confirm Text Input:**

  ```
  Enter "QA Test" into the text input field and confirm the input is correct
  ```

- **Check Tap Response:**

  ```
  Tap on coordinates x=250, y=400 and verify the expected element is triggered
  ```

- **Validate Swipe Action:**

  ```
  Swipe from x=150, y=600 to x=150, y=100 and confirm correct behavior
  ```

- **Detailed Element Check:**

  ```
  Describe the UI element at position x=300, y=350 to ensure proper labeling and functionality
  ```

- **Show Your AI Agent the Simulator Screen:**

  ```
  View the current simulator screen
  ```

- **Take Screenshot:**

  ```
  Take a screenshot of the current simulator screen and save it to my_screenshot.png
  ```

- **Record Video:**

  ```
  Start recording a video of the simulator screen (saves to the default output directory, which is `~/Downloads` unless overridden by `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR`)
  ```

- **Stop Recording:**

  ```
  Stop the current simulator screen recording
  ```

- **Install App:**

  ```
  Install the app at path/to/MyApp.app on the simulator
  ```

- **Launch App:**
  ```
  Launch the Safari app (com.apple.mobilesafari) on the simulator
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
    claude mcp add ios-simulator --command node --args "/full/path/to/your/ios-simulator-mcp/build/index.js"
    ```
    **Important:** Replace `/full/path/to/your/` with the absolute path to where you cloned the `ios-simulator-mcp` repository.
3.  Restart any running Claude Code sessions if necessary.

## Configuration

### Environment Variables

| Variable                               | Description                                                                                                                                                                                          | Example                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `IOS_SIMULATOR_MCP_FILTERED_TOOLS`     | A comma-separated list of tool names to filter out from being registered.                                                                                                                            | `screenshot,record_video,stop_recording` |
| `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` | Specifies a default directory for output files like screenshots and video recordings. If not set, `~/Downloads` will be used. This can be handy if your agent has limited access to the file system. | `~/Code/awesome-project/tmp`             |

#### Configuration Example

```json
{
  "mcpServers": {
    "ios-simulator": {
      "command": "npx",
      "args": ["-y", "ios-simulator-mcp"],
      "env": {
        "IOS_SIMULATOR_MCP_FILTERED_TOOLS": "screenshot,record_video,stop_recording",
        "IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR": "~/Code/awesome-project/tmp"
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
