# Quality Assurance

This guide contains manual quality assurance tests to make sure all the tools in this MCP server is functional on release.

You can run a test case copy and pasting the test case into a chat in an MCP client (like Cursor) that can run MCP tools.

## Test Case: Photos app

**Note:** This test case was written using iOS 17.2 and the native Photos app. It may need to be adjusted for other iOS versions or Photos app changes.

1. Have the user open the native Photo app in the iOS simulator.
2. Call `get_booted_sim_id` to get the UDID of the booted simulator.
3. Call `record_video` to start recording a screen recording of the test.
4. Call `ui_describe_all` to make sure we are on the All Photos tab.
5. Call `ui_describe_point` to find the x and y coordinates for tapping the Search tab button.
6. Call `ui_tap` to tap the Search tab button.
7. Call `ui_tap` to focus on the Search text input.
8. Call `ui_type` to type "Photos" into the Search text input.
9. Call `ui_describe_all` to describe the page and find the first photo result.
10. Call `ui_describe_point` to find the x and y coordinates for the first photo result touchable area.
11. Call `ui_tap` to tap the coordinates of the first photo result touchable area
12. Call `ui_swipe` to swipe from the center of the screen down to dismiss the photo and go back to the All Photos tab.
13. Call `ui_describe_all` to describe the page and see we are the All Photos tab.
14. Call `screenshot` to take a screenshot of the current page.
15. Call `ui_view` to view the current page.
16. Call `stop_recording` to stop the screen recording.
