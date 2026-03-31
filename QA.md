# Quality Assurance

This guide contains manual quality assurance tests to make sure all the tools in this MCP server is functional on release.

You can run a test case copy and pasting the test case into a chat in an MCP client (like Cursor) that can run MCP tools.

## Test Case: Photos app

**Note:** This test case was written using iOS 17.2 and the native Photos app. It may need to be adjusted for other iOS versions or Photos app changes.

1. Have the user open the native Photo app in the iOS simulator.
2. Call `get_booted_sim_ids` to get the names and UDIDs of the booted simulators, choose the simulator under test, and keep that UDID handy for the recording steps below.
3. Call `record_video` with the chosen simulator UDID to start recording a screen recording of the test.
4. Call `ui_describe_all` with the chosen simulator UDID to make sure we are on the All Photos tab.
5. Call `ui_find_element` with the chosen simulator UDID and `{ "search": ["Search"], "type": "Button" }` to find the Search tab button by its label.
6. Call `ui_describe_point` with the chosen simulator UDID to verify the coordinates returned by `ui_find_element` for the Search tab button.
7. Call `ui_tap` with the chosen simulator UDID to tap the Search tab button.
8. Call `ui_tap` with the chosen simulator UDID to focus on the Search text input.
9. Call `ui_type` with the chosen simulator UDID to type "Photos" into the Search text input.
10. Call `ui_describe_all` with the chosen simulator UDID to describe the page and find the first photo result.
11. Call `ui_describe_point` with the chosen simulator UDID to find the x and y coordinates for the first photo result touchable area.
12. Call `ui_tap` with the chosen simulator UDID to tap the coordinates of the first photo result touchable area.
13. Call `ui_swipe` with the chosen simulator UDID to swipe from the center of the screen down to dismiss the photo and go back to the All Photos tab.
14. Call `ui_describe_all` with the chosen simulator UDID to describe the page and see we are the All Photos tab.
15. Call `screenshot` with the chosen simulator UDID to take a screenshot of the current page.
16. Call `read_screen` with the chosen simulator UDID to view the current page.
17. Call `stop_recording` with the same simulator UDID to stop the screen recording.

## Test Case: Landscape orientation

**Note:** Run this on an iPad simulator and rotate the Simulator window to landscape before starting.

1. Have the user open the iPad Simulator in landscape and show the Home Screen or Photos app.
2. Call `get_booted_sim_ids` and pick the landscape simulator under test.
3. Call `read_screen` with the chosen simulator UDID and verify the returned image is landscape-shaped and matches the presented Simulator orientation.
4. Call `ui_describe_all` with the chosen simulator UDID and confirm the root `frame` dimensions are landscape-oriented.
5. Call `ui_find_element` with the chosen simulator UDID to locate a visible element in the current landscape view.
6. Use the returned frame coordinates with `ui_tap` and the chosen simulator UDID to verify the visible element is activated.
7. Call `ui_describe_point` with the chosen simulator UDID and a point chosen from the visible landscape image, then confirm it identifies the expected element.
8. Call `ui_swipe` with the chosen simulator UDID and a vertical swipe in the visible landscape image, then confirm the gesture moves in the expected on-screen direction.
9. Call `screenshot` with the chosen simulator UDID and verify the saved file matches the same presented landscape orientation as `read_screen`.
