# iOS Simulator MCP - TROUBLESHOOTING

If you encounter errors or issues using this MCP server, try the following troubleshooting steps before reporting a bug:

## 1. Prerequisites
- **macOS Only:** This server only works on macOS with Xcode and iOS simulators installed.
- **IDB Tool:** Ensure [Facebook IDB](https://fbidb.io/) is installed and available in your PATH.
- **Node.js:** Make sure Node.js is installed and up to date.

## 2. Installing IDB 

The installation section in [IDB](https://fbidb.io/docs/installation/) is a little out of date. Since [python environments are famously borked](https://xkcd.com/1987/), here are some ways to install that are hopefully compatible with your existing python install.

IDB has two parts: `idb_companion` (a native binary, installed with Homebrew) and the `fb-idb` Python client (the `idb` command).

### Using Homebrew + uv (recommended)

1. Install the companion. Homebrew 7 refuses formulae from third-party taps until you trust them, hence the `brew trust` step:
   ```sh
   brew tap facebook/fb
   brew trust --formula facebook/fb/idb-companion
   brew install idb-companion
   ```
   If you already have it, run `brew upgrade idb-companion`, then `idb kill` so the old companion process stops serving your simulators. Old companions (e.g. 1.1.8) break `ui_type` with `method: "paste"`.
2. Install the client with [uv](https://docs.astral.sh/uv/), which keeps it in its own environment:
   ```sh
   brew install uv
   uv tool install --python 3.12 fb-idb
   ```
3. Make sure `~/.local/bin` is in your PATH (`uv tool update-shell` adds it), then verify:
   ```sh
   idb list-targets
   ```

Homebrew's Python refuses `pip install --user fb-idb` with `error: externally-managed-environment` (PEP 668), so use uv as above or pip with a Python you manage yourself (asdf below).

### Using asdf (Python version manager)

1. Install [asdf](https://asdf-vm.com/):
   ```sh
   brew install asdf
   ```
2. Add the [Python plugin](https://github.com/asdf-community/asdf-python), install Python, set to global version (see asdf docs for [set](https://asdf-vm.com/manage/versions.html#set-version) and [global](https://asdf-vm.com/guide/getting-started-legacy.html#global) to do isolated installs):
   ```sh
   asdf plugin add python
   asdf install python latest
   asdf global python latest
   asdf set python <latest-version> -u
   asdf reshim
   ```
3. Install idb using pip:
   ```sh
   python -m pip install --user fb-idb
   ```
4. Ensure your user base binary directory is in your PATH (often `~/.local/bin`):
   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   # Add the above line to your ~/.zshrc or ~/.bash_profile for persistence
   ```
5. Verify installation:
   ```sh
   idb -h
   ```

## 3. Common Issues & Fixes

### "No booted simulator found"
- Open Xcode and boot an iOS simulator manually.
- Run `xcrun simctl list devices` to verify a simulator is booted.

### "idb: command not found" or IDB errors
- Follow the install steps above (Homebrew + uv, or asdf).
- Ensure `idb` is in your PATH: try running `idb list-targets` in your terminal. If your MCP client doesn't see `~/.local/bin` (`spawn idb ENOENT`), set `IOS_SIMULATOR_MCP_IDB_PATH` to the full path of `idb`.

### Permission or File Errors
- Ensure you have permission to write to the output path (e.g., for screenshots or recordings).
- Try using a path in your home directory or `~/Downloads`.

### `ui_type` with `method: "paste"` is slow or fails on newer iOS 27 simulators
Some simulator runtimes (seen on iOS 27.2) cannot show iOS's "Allow Paste" prompt, so pasting with Cmd+V does nothing. The server then pastes with the Paste item of the field's edit menu, which takes about 8 to 13 s per call. If that fails too, or to make pasting faster:
- Keep Xcode's Device Hub open and showing that simulator: Cmd+V then pastes without a prompt. (While Device Hub shows a different simulator, the clipboard of this one can get stuck; see below.)
- Or allow pasting for the app in the simulator's privacy database (this edits simulator data directly; replace the UDID and bundle ID, and call `ui_type` with `method: "paste"` in the app once first, which creates the row; if the command prints `0`, the row does not exist yet):
  ```sh
  sqlite3 ~/Library/Developer/CoreSimulator/Devices/<udid>/data/Library/TCC/TCC.db \
    "UPDATE access SET auth_value=2 WHERE service='kTCCServicePasteboard' AND client='<bundle id>'; SELECT changes()"
  ```
- Or use the default `method: "type"` when the text is printable ASCII and the keyboard layout is US.

### `ui_type` with `method: "paste"` says the simulator clipboard did not take the text
The simulator pasteboard can get stuck: `xcrun simctl pbcopy` succeeds but the clipboard keeps its old content. Reboot the simulator, then run `idb kill`. This was seen while Xcode's Device Hub was open and showing a different simulator, and rebooting alone did not help then: quit Device Hub (or have it show this simulator) before rebooting.

### Simulator UI Not Responding
- Restart the simulator and try again.
- Quit and relaunch Xcode if needed.
- Prompt AI to check dimensions of the simulator screen and adjust coordinates to it. Screenshots have 3x resolution and this may result in incorrect position of screen presses.

## 4. Still Stuck?
- Check the [README](./README.md) for setup and usage instructions.
- If the problem persists, [open an issue](https://github.com/joshuayoes/ios-simulator-mcp/issues) and include the error message and steps to reproduce.

