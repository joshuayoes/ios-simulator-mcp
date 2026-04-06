import Foundation
import MCP

// MARK: - Tool Definitions

enum UITools {
    static let uiDescribeAll = ToolRegistry.ToolEntry(
        name: "ui_describe_all",
        tool: Tool(
            name: "ui_describe_all",
            description: "Get accessibility information for the entire simulator screen. Returns a hierarchical JSON structure of all UI elements with their types, labels, values, and frames. Uses XCUITest directly — no idb required.",
            inputSchema: .objectSchema(properties: [
                "interactive_only": .booleanProperty("Only return interactive elements (buttons, text fields, etc.)", defaultValue: false),
                "udid": .udidProperty,
            ])
        )
    )

    static let uiDescribePoint = ToolRegistry.ToolEntry(
        name: "ui_describe_point",
        tool: Tool(
            name: "ui_describe_point",
            description: "Get the accessibility element at a specific screen coordinate",
            inputSchema: .objectSchema(
                properties: [
                    "x": .numberProperty("X coordinate in points"),
                    "y": .numberProperty("Y coordinate in points"),
                    "udid": .udidProperty,
                ],
                required: ["x", "y"]
            )
        )
    )

    static let uiTap = ToolRegistry.ToolEntry(
        name: "ui_tap",
        tool: Tool(
            name: "ui_tap",
            description: "Tap the simulator screen at the specified coordinates",
            inputSchema: .objectSchema(
                properties: [
                    "x": .numberProperty("X coordinate in points"),
                    "y": .numberProperty("Y coordinate in points"),
                    "duration": .numberProperty("Tap duration in seconds (optional, for long press)"),
                    "udid": .udidProperty,
                ],
                required: ["x", "y"]
            )
        )
    )

    static let uiDoubleTap = ToolRegistry.ToolEntry(
        name: "ui_double_tap",
        tool: Tool(
            name: "ui_double_tap",
            description: "Double-tap the simulator screen at the specified coordinates",
            inputSchema: .objectSchema(
                properties: [
                    "x": .numberProperty("X coordinate in points"),
                    "y": .numberProperty("Y coordinate in points"),
                    "udid": .udidProperty,
                ],
                required: ["x", "y"]
            )
        )
    )

    static let uiLongPress = ToolRegistry.ToolEntry(
        name: "ui_long_press",
        tool: Tool(
            name: "ui_long_press",
            description: "Long press the simulator screen at the specified coordinates",
            inputSchema: .objectSchema(
                properties: [
                    "x": .numberProperty("X coordinate in points"),
                    "y": .numberProperty("Y coordinate in points"),
                    "duration": .numberProperty("Press duration in seconds (default: 1.0)"),
                    "udid": .udidProperty,
                ],
                required: ["x", "y"]
            )
        )
    )

    static let uiType = ToolRegistry.ToolEntry(
        name: "ui_type",
        tool: Tool(
            name: "ui_type",
            description: "Type text into the currently focused input field, or into a specific element by accessibility identifier. Supports full Unicode including emoji.",
            inputSchema: .objectSchema(
                properties: [
                    "text": .stringProperty("The text to type (supports full Unicode, max 500 chars)", maxLength: 500),
                    "identifier": .stringProperty("Optional accessibility identifier of the target element"),
                    "udid": .udidProperty,
                ],
                required: ["text"]
            )
        )
    )

    static let uiSwipe = ToolRegistry.ToolEntry(
        name: "ui_swipe",
        tool: Tool(
            name: "ui_swipe",
            description: "Swipe on the simulator screen from one point to another",
            inputSchema: .objectSchema(
                properties: [
                    "x_start": .numberProperty("Starting X coordinate"),
                    "y_start": .numberProperty("Starting Y coordinate"),
                    "x_end": .numberProperty("Ending X coordinate"),
                    "y_end": .numberProperty("Ending Y coordinate"),
                    "duration": .numberProperty("Swipe duration in seconds (default: 0.3)"),
                    "udid": .udidProperty,
                ],
                required: ["x_start", "y_start", "x_end", "y_end"]
            )
        )
    )

    static let uiFindElement = ToolRegistry.ToolEntry(
        name: "ui_find_element",
        tool: Tool(
            name: "ui_find_element",
            description: "Find a UI element by its accessibility identifier or label. Returns the element's type, frame, and properties.",
            inputSchema: .objectSchema(properties: [
                "identifier": .stringProperty("Accessibility identifier to search for"),
                "label": .stringProperty("Accessibility label to search for"),
                "udid": .udidProperty,
            ])
        )
    )

    static let uiPressHome = ToolRegistry.ToolEntry(
        name: "ui_press_home",
        tool: Tool(
            name: "ui_press_home",
            description: "Press the home button on the simulator",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleUIDescribeAll(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = args.string("udid")
        let interactiveOnly = args.bool("interactive_only") ?? false
        let result = try await runner.snapshot(udid: udid, interactiveOnly: interactiveOnly)
        return [.text(result)]
    }

    func handleUIDescribePoint(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_describe_point", "x and y coordinates are required")
        }
        let udid = args.string("udid")
        let result = try await runner.describePoint(x: x, y: y, udid: udid)
        return [.text(result)]
    }

    func handleUITap(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_tap", "x and y coordinates are required")
        }
        let duration = args.double("duration")
        let udid = args.string("udid")
        try await runner.tap(x: x, y: y, duration: duration, udid: udid)
        return [.text("Tapped at (\(x), \(y))")]
    }

    func handleUIDoubleTap(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_double_tap", "x and y coordinates are required")
        }
        let udid = args.string("udid")
        try await runner.doubleTap(x: x, y: y, udid: udid)
        return [.text("Double-tapped at (\(x), \(y))")]
    }

    func handleUILongPress(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_long_press", "x and y coordinates are required")
        }
        let duration = args.double("duration") ?? 1.0
        let udid = args.string("udid")
        try await runner.longPress(x: x, y: y, duration: duration, udid: udid)
        return [.text("Long pressed at (\(x), \(y)) for \(duration)s")]
    }

    func handleUIType(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let text = args.string("text") else {
            throw SimctlError.commandFailed("ui_type", "text is required")
        }
        guard text.count <= 500 else {
            throw SimctlError.commandFailed("ui_type", "Text must be 500 characters or fewer")
        }

        let identifier = args.string("identifier")
        let udid = args.string("udid")
        try await runner.typeText(text, identifier: identifier, udid: udid)
        return [.text("Typed \(text.count) characters")]
    }

    func handleUISwipe(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let xStart = args.double("x_start"),
              let yStart = args.double("y_start"),
              let xEnd = args.double("x_end"),
              let yEnd = args.double("y_end")
        else {
            throw SimctlError.commandFailed("ui_swipe", "x_start, y_start, x_end, y_end are required")
        }
        let duration = args.double("duration")
        let udid = args.string("udid")

        try await runner.swipe(
            xStart: xStart, yStart: yStart,
            xEnd: xEnd, yEnd: yEnd,
            duration: duration,
            udid: udid
        )
        return [.text("Swiped from (\(xStart), \(yStart)) to (\(xEnd), \(yEnd))")]
    }

    func handleUIFindElement(_ args: [String: Value]) async throws -> [Tool.Content] {
        let identifier = args.string("identifier")
        let label = args.string("label")
        let udid = args.string("udid")

        guard identifier != nil || label != nil else {
            throw SimctlError.commandFailed("ui_find_element", "identifier or label is required")
        }

        let result = try await runner.findElement(identifier: identifier, label: label, udid: udid)
        return [.text(result)]
    }

    func handleUIPressHome(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = args.string("udid")
        try await runner.pressButton("home", udid: udid)
        return [.text("Home button pressed")]
    }
}
