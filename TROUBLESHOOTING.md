# iOS Simulator MCP - TROUBLESHOOTING

If you encounter errors or issues using this MCP server, try the following troubleshooting steps before reporting a bug:

## 1. Prerequisites
- **macOS Only:** This server only works on macOS with Xcode and iOS simulators installed.
- **IDB Tool:** Ensure [Facebook IDB](https://fbidb.io/) is installed and available in your PATH.
- **Node.js:** Make sure Node.js is installed and up to date.

## 2. Installing IDB 

The installation section in [IDB](https://fbidb.io/docs/installation/) is a little out of date. Since [python environments are famously borked](https://xkcd.com/1987/), here are some ways to install that are hopefully compatible with your existing python install.

### Using Homebrew + pip

1. Install [Homebrew](https://brew.sh/) if you don't have it:
   ```sh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. Install Python (if not already installed):
   ```sh
   brew install python
   ```
3. Install idb using pip:
   ```sh
   pip3 install --user fb-idb
   ```
4. Ensure your user base binary directory is in your PATH (often `~/.local/bin`):
   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   # Add the above line to your ~/.zshrc or ~/.bash_profile for persistence
   ```
5. Verify installation:
   ```sh
   idb --version
   ```

### Using asdf (Python version manager)

1. Install [asdf](https://asdf-vm.com/):
   ```sh
   brew install asdf
   ```
2. Add the [Python plugin](https://github.com/asdf-community/asdf-python) and install Python:
   ```sh
   asdf plugin add python
   asdf install python latest
   asdf global python latest
   ```
3. Install idb using pip:
   ```sh
   pip install --user fb-idb
   ```
4. Ensure your user base binary directory is in your PATH (often `~/.local/bin`):
   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   # Add the above line to your ~/.zshrc or ~/.bash_profile for persistence
   ```
5. Verify installation:
   ```sh
   idb --version
   ```

## 3. Common Issues & Fixes

### "No booted simulator found"
- Open Xcode and boot an iOS simulator manually.
- Run `xcrun simctl list devices` to verify a simulator is booted.

### "idb: command not found" or IDB errors
- Follow the install steps above for Homebrew + pip or asdf.
- Ensure `idb` is in your PATH: try running `idb --version` in your terminal.

### Permission or File Errors
- Ensure you have permission to write to the output path (e.g., for screenshots or recordings).
- Try using a path in your home directory or `~/Downloads`.

### Simulator UI Not Responding
- Restart the simulator and try again.
- Quit and relaunch Xcode if needed.
- Prompt AI to check dimensions of the simulator screen and adjust coordinates to it. Screenshots have 3x resolution and this may result in incorrect position of screen presses.

## 4. Still Stuck?
- Check the [README](./README.md) for setup and usage instructions.
- If the problem persists, [open an issue](https://github.com/joshuayoes/ios-simulator-mcp/issues) and include the error message and steps to reproduce.

