import Foundation
import MCP

// MARK: - Tool Definitions

enum UITools {
    static let uiDescribeAll = ToolRegistry.ToolEntry(
        name: "ui_describe_all",
        tool: Tool(
            name: "ui_describe_all",
            description: "Get accessibility information for the entire simulator screen. Returns a hierarchical JSON structure of all UI elements with their types, labels, values, and frames.",
            inputSchema: .objectSchema(properties: [
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

    static let uiType = ToolRegistry.ToolEntry(
        name: "ui_type",
        tool: Tool(
            name: "ui_type",
            description: "Type text into the currently focused input field on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "text": .stringProperty(
                        "The text to type (ASCII printable characters, max 500 chars)",
                        maxLength: 500,
                        pattern: "^[\\x20-\\x7E]+$"
                    ),
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
                    "duration": .numberProperty("Swipe duration in seconds (optional)"),
                    "delta": .integerProperty("Step size for the swipe (default: 1)"),
                    "udid": .udidProperty,
                ],
                required: ["x_start", "y_start", "x_end", "y_end"]
            )
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleUIDescribeAll(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = args.string("udid")
        let result = try await idb.describeAll(udid: udid)
        return [.text(result)]
    }

    func handleUIDescribePoint(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_describe_point", "x and y coordinates are required")
        }
        let udid = args.string("udid")
        let result = try await idb.describePoint(x: x, y: y, udid: udid)
        return [.text(result)]
    }

    func handleUITap(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let x = args.double("x"), let y = args.double("y") else {
            throw SimctlError.commandFailed("ui_tap", "x and y coordinates are required")
        }
        let duration = args.double("duration")
        let udid = args.string("udid")
        try await idb.tap(x: x, y: y, duration: duration, udid: udid)
        return [.text("Tapped at (\(x), \(y))")]
    }

    func handleUIType(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let text = args.string("text") else {
            throw SimctlError.commandFailed("ui_type", "text is required")
        }

        // Validate ASCII printable characters
        let asciiPattern = #"^[\x20-\x7E]+$"#
        guard text.range(of: asciiPattern, options: .regularExpression) != nil else {
            throw SimctlError.commandFailed("ui_type", "Text must contain only ASCII printable characters (space through tilde)")
        }
        guard text.count <= 500 else {
            throw SimctlError.commandFailed("ui_type", "Text must be 500 characters or fewer")
        }

        let udid = args.string("udid")
        try await idb.typeText(text, udid: udid)
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
        let delta = args.int("delta") ?? 1
        let udid = args.string("udid")

        try await idb.swipe(
            xStart: xStart, yStart: yStart,
            xEnd: xEnd, yEnd: yEnd,
            duration: duration,
            delta: delta,
            udid: udid
        )
        return [.text("Swiped from (\(xStart), \(yStart)) to (\(xEnd), \(yEnd))")]
    }
}
