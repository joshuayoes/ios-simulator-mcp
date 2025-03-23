# iOS Simulator MCP Server

[![NPM Version](https://img.shields.io/npm/v/ios-simulator-mcp)](https://www.npmjs.com/package/ios-simulator-mcp)

A Model Context Protocol (MCP) server for interacting with iOS simulators. This server allows you to interact with iOS simulators by getting information about them, controlling UI interactions, and inspecting UI elements.

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

## 💡 Use Case: QA Step in Agent Mode

This MCP can be used effectively in agent mode as a Quality Assurance step immediately after implementing features, ensuring UI consistency and correct behavior.

### How to Use

After a feature implementation:

1. Activate agent mode in Cursor.
2. Use the prompts below to quickly validate and document UI interactions.

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

- **Take Screenshot:**

  ```
  Take a screenshot of the current simulator screen and save it to my_screenshot.png
  ```

- **Record Video:**

  ```
  Start recording a video of the simulator screen (saves to ~/Downloads/simulator_recording_$DATE.mp4 by default)
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

### Option 1: Using NPX (Recommended)

1. Edit your Cursor MCP configuration:

   ```bash
   cursor ~/.cursor/mcp.json
   ```

2. Add the iOS simulator server to your configuration:

   ```json
   {
     "mcpServers": {
       "ios-simulator": {
         "command": "npx",
         "args": ["-y", "ios-simulator-mcp"]
       }
     }
   }
   ```

3. Restart Cursor.

### Option 2: Local Development

1. Clone this repository:

   ```bash
   git clone https://github.com/joshuayoes/ios-simulator-mcp
   cd ios-simulator-mcp
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Edit your Cursor MCP configuration:

   ```bash
   cursor ~/.cursor/mcp.json
   ```

5. Add the iOS simulator server to your configuration:

   ```json
   {
     "mcpServers": {
       "ios-simulator": {
         "command": "node",
         "args": ["/path/to/your/ios-simulator-mcp/build/index.js"]
       }
     }
   }
   ```

   Replace `"/path/to/your"` with the actual path to your project directory.

6. Restart Cursor.

## License

MIT
