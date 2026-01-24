# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the iOS Simulator MCP (Model Context Protocol) server - a tool that enables AI assistants to interact with iOS simulators through MCP. The project follows an **intentionally simple** single-file architecture where all logic is contained in `src/index.ts`.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build the TypeScript project (compiles to build/)
npm run build

# Development with automatic rebuild on changes
npm run watch

# Run the MCP inspector for testing
npm run dev

# Start the compiled server
npm start
```

## Architecture

The entire server implementation is in `src/index.ts` (single file by design). The server:
- Uses the MCP SDK to expose tools for iOS simulator interaction
- Wraps `xcrun simctl` and Facebook's `idb` commands
- Validates all inputs with Zod schemas
- Implements security best practices with `--` argument separation
- Supports environment-based tool filtering via `IOS_SIMULATOR_MCP_FILTERED_TOOLS`
- Handles output paths with `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR` environment variable

## Available MCP Tools

The server provides these tools (can be filtered via environment variables):
- `get_booted_sim_id` - Get the currently booted simulator ID
- `open_simulator` - Open the iOS Simulator application
- `ui_describe_all` - Get accessibility info for the entire screen
- `ui_tap` - Tap at coordinates
- `ui_type` - Input text
- `ui_swipe` - Swipe gesture
- `ui_describe_point` - Get element at specific coordinates
- `ui_view` - Get compressed screenshot as base64 JPEG
- `screenshot` - Save screenshot to file
- `record_video` - Start video recording
- `stop_recording` - Stop video recording
- `install_app` - Install an app bundle (.app or .ipa) on the simulator
- `launch_app` - Launch an app by bundle identifier

## Testing

This project requires **manual testing** on macOS with:
- Xcode and iOS simulators installed
- Facebook IDB tool installed
- An MCP client (like Cursor) configured to use the server

Test changes by:
1. Building with `npm run build`
2. Configuring your MCP client to point to `build/index.js`
3. Running through the test cases in `QA.md`

## Important Design Principles

- **Keep it simple**: Single file, minimal dependencies, standard tooling (npm/tsc)
- **Real use cases only**: Don't add hypothetical features
- **Security first**: Always use `--` separator for user inputs, validate with Zod
- **No architecture changes** without discussion - the single-file design is intentional

## Additional Documentation

For more detailed information, refer to these documentation files:

- **[README.md](README.md)** - Complete project documentation including installation instructions, available tools, configuration options, and usage examples
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines, development setup, dependency management, and the project's philosophy of intentional simplicity
- **[QA.md](QA.md)** - Manual quality assurance test cases for validating functionality
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and their solutions, including IDB installation help
- **[SECURITY.md](SECURITY.md)** - Security policy and information about fixed vulnerabilities
- **[CONTEXT.md](CONTEXT.md)** - Reference links for MCP documentation, iOS simulator commands, IDB commands, and security best practices