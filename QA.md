# Quality Assurance

This guide contains manual quality assurance tests to make sure all the tools in this MCP server is functional on release.

You can run a test case copy and pasting the test case into a chat in an MCP client (like Cursor) that can run MCP tools.

## Test Case: Photos app

**Note:** This test case was written using iOS 17.2 and the native Photos app. It may need to be adjusted for other iOS versions or Photos app changes.

1. Have the user open the native Photo app in the iOS simulator.
2. Call `get_booted_sim_id` to get the UDID of the booted simulator.
3. Call `record_video` to start recording a screen recording of the test.
4. Call `ui_describe_all` to make sure we are on the All Photos tab.
5. Call `ui_find_element` with `{ "search": ["Search"], "type": "Button" }` to find the Search tab button by its label.
6. Call `ui_describe_point` to verify the coordinates returned by `ui_find_element` for the Search tab button.
7. Call `ui_tap` to tap the Search tab button.
8. Call `ui_tap` to focus on the Search text input.
9. Call `ui_type` to type "Photos" into the Search text input.
10. Call `ui_describe_all` to describe the page and find the first photo result.
11. Call `ui_describe_point` to find the x and y coordinates for the first photo result touchable area.
12. Call `ui_tap` to tap the coordinates of the first photo result touchable area
13. Call `ui_swipe` to swipe from the center of the screen down to dismiss the photo and go back to the All Photos tab.
14. Call `ui_describe_all` to describe the page and see we are the All Photos tab.
15. Call `screenshot` to take a screenshot of the current page.
16. Call `ui_view` to view the current page.
17. Call `stop_recording` to stop the screen recording.

## Test Case: App Lifecycle (terminate_app, open_url, list_apps)

**Note:** Assumes at least one simulator is booted.

1. Call `get_booted_sim_id` to get the UDID of the booted simulator.
2. Call `list_apps` and confirm the response includes at least Safari (`com.apple.mobilesafari`) along with other system apps, sorted alphabetically by display name.
3. Call `open_url` with `https://example.com` and confirm Safari launches and loads the page.
4. Call `terminate_app` with `com.apple.mobilesafari` and confirm Safari is no longer running (Safari window closes / home screen is shown).
5. Call `open_url` with a custom-scheme deep link for an app you have installed (e.g. `maps://?q=Apple+Park`) and confirm the correct app opens.
6. Call `terminate_app` with a bogus bundle ID (e.g. `com.does.not.exist`) and confirm a friendly error message is returned.
