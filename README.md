# iOS Simulator MCP Server

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=ios-simulator&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImlvcy1zaW11bGF0b3ItbWNwIl19) [![NPM Version](https://img.shields.io/npm/v/ios-simulator-mcp)](https://www.npmjs.com/package/ios-simulator-mcp)

A Model Context Protocol (MCP) server for interacting with iOS simulators. This server allows you to interact with iOS simulators by getting information about them, controlling UI interactions, and inspecting UI elements.

> **Security Notice**: Command injection vulnerabilities present in versions < 1.3.3 have been fixed. Please update to v1.3.3 or later. See [SECURITY.md](SECURITY.md) for details.

https://github.com/user-attachments/assets/453ebe7b-cc93-4ac2-b08d-0f8ac8339ad3

## Features

- Get the ID of the currently booted iOS simulator
- Interact with the simulator UI:
  - Describe all accessibility elements on screen
  - Tap on screen coordinates
  - Input text
  - Swipe between coordinates
  - Get information about UI elements at specific coordinates
  - Take screenshots of the simulator screen
  - Show a view of the simulator screen to your AI agent
- Filter specific tools using environment variables

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
