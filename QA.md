# Quality Assurance

A manual release scenario: one scripted agent transcript that exercises every
tool against a real booted simulator. Paste it into an MCP client configured
with this server (see [TESTING.md](TESTING.md) for the harness setup and
`--strict-mcp-config` isolation) and judge the transcript by eye.

This is deliberately **version-agnostic**: it targets the Settings app (the
most stable built-in across iOS releases) and describes intent rather than
exact labels or coordinates. If a step's label doesn't exist on your iOS
version, substitute the nearest equivalent — the point is that each tool gets
one real exercise, not that the script replays byte-for-byte.

**Preconditions:** one simulator booted, **portrait orientation** (coordinate
handling under rotation is inconsistent until issue #49 is fixed), idb
installed.

## Release scenario: Settings app

1. Call `open_simulator` to bring the Simulator app to the foreground.
2. Call `get_booted_sim_id` and note the UDID.
3. Call `record_video` to start a recording of the session.
4. Call `launch_app` with `{ "bundle_id": "com.apple.Preferences", "terminate_running": true }` so the run starts from the Settings root screen.
5. Call `ui_describe_all` and confirm a parseable accessibility tree for the Settings root.
6. Call `ui_find_element` with `{ "search": ["General"], "type": "Button" }` and note the returned frame.
7. Call `ui_describe_point` at the center of that frame and confirm it returns the same element.
8. Call `ui_tap` at the center of that frame, then `ui_describe_all` to confirm the General screen opened.
9. Call `ui_swipe` from the upper part of the screen downward past the middle (e.g. center-top to center-bottom) to scroll back up, or on the root screen to reveal the search field.
10. Tap the Settings search field (find it with `ui_find_element` first), then call `ui_type` with `"About"` and confirm results appear via `ui_describe_all`.
11. Call `ui_view` and confirm the returned image matches the current screen.
12. Call `screenshot` with a filename like `qa-run.png` and confirm the reported absolute path exists.
13. Call `stop_recording` and confirm the video file exists at the reported path and plays.
14. If you have any `.app` bundle available (e.g. from a local Xcode build), call `install_app` with its path and then `launch_app` with its bundle id; otherwise note the step as skipped.

A pass is: every call returns without `isError`, the taps land where the
find/describe steps said they would, and the screenshot/video artifacts exist
and show the run. Anything else is a finding — file it.

## Non-US keyboard scenario (ui_type method "paste")

1. With the simulator booted and Simulator.app showing it (booting or reconnecting resets the keyboard list), add a French AZERTY keyboard: `xcrun simctl spawn <udid> defaults write -g AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic" "emoji@sw=Emoji" "fr_FR@sw=AZERTY;hw=French"`.
2. In a text field (e.g. Settings search), tap the globe key until `xcrun simctl spawn <udid> defaults read com.apple.keyboard.preferences KeyboardLastUsed` shows `fr_FR@sw=AZERTY;hw=French` (dismiss any keyboard intro sheet first), then terminate and relaunch the app so it picks up the layout.
3. Call `ui_type` with `text: "mobiletest@example.com"` and the default method; confirm via `ui_describe_all` that the field shows the wrong characters (`,obiletest2exq,ple:co,`).
4. Call `ui_type` again with `method: "paste"` and `replace: true`; confirm the field contains exactly `mobiletest@example.com`. Clear the field (e.g. its clear button) and paste `"café déjà vu"` the same way without `replace`.
5. Open Safari, tap the address bar, and call `ui_type` with `text: "http://localhost:8081"` and `method: "paste"`; confirm the "Allow Paste" prompt is accepted automatically and the address bar contains exactly that text.
6. Restore the keyboards: `xcrun simctl spawn <udid> defaults write -g AppleKeyboards -array "en_US@sw=QWERTY;hw=Automatic" "emoji@sw=Emoji"`.

## App lifecycle scenario (terminate_app, open_url, list_apps)

1. Call `get_booted_sim_id` and note the UDID.
2. Call `list_apps` and confirm the response includes at least Safari (`com.apple.mobilesafari`) along with other system apps, sorted alphabetically by display name.
3. Call `open_url` with `https://example.com` and confirm Safari launches and loads the page.
4. Call `terminate_app` with `com.apple.mobilesafari` and confirm Safari is no longer running (relaunching Safari via `launch_app` should cold-start it).
5. Call `open_url` with a custom-scheme deep link for an app on the simulator (e.g. `maps://?q=Apple+Park`) and confirm the correct app opens.
6. Call `terminate_app` with the same bundle id again (app no longer running) and confirm a graceful error mentioning simctl's "found nothing to terminate".
