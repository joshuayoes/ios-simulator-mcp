import Foundation
import MCP

// MARK: - Tool Definitions

enum DeviceTools {
    static let setAppearance = ToolRegistry.ToolEntry(
        name: "set_appearance",
        tool: Tool(
            name: "set_appearance",
            description: "Set the simulator appearance to light or dark mode",
            inputSchema: .objectSchema(
                properties: [
                    "appearance": .enumProperty("The appearance mode", values: ["light", "dark"]),
                    "udid": .udidProperty,
                ],
                required: ["appearance"]
            )
        )
    )

    static let getAppearance = ToolRegistry.ToolEntry(
        name: "get_appearance",
        tool: Tool(
            name: "get_appearance",
            description: "Get the current appearance mode (light/dark) of the simulator",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )

    static let setLocation = ToolRegistry.ToolEntry(
        name: "set_location",
        tool: Tool(
            name: "set_location",
            description: "Simulate a GPS location on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "latitude": .numberProperty("Latitude coordinate", minimum: -90, maximum: 90),
                    "longitude": .numberProperty("Longitude coordinate", minimum: -180, maximum: 180),
                    "udid": .udidProperty,
                ],
                required: ["latitude", "longitude"]
            )
        )
    )

    static let clearLocation = ToolRegistry.ToolEntry(
        name: "clear_location",
        tool: Tool(
            name: "clear_location",
            description: "Clear the simulated GPS location",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )

    static let setPrivacy = ToolRegistry.ToolEntry(
        name: "set_privacy",
        tool: Tool(
            name: "set_privacy",
            description: "Grant, revoke, or reset privacy permissions for an app on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "action": .enumProperty("The privacy action to perform", values: ["grant", "revoke", "reset"]),
                    "service": .stringProperty("The privacy service (e.g. photos, camera, microphone, location, contacts, calendar, reminders, notifications)"),
                    "bundle_id": .stringProperty("The bundle identifier of the app", maxLength: 256),
                    "udid": .udidProperty,
                ],
                required: ["action", "service", "bundle_id"]
            )
        )
    )

    static let openURL = ToolRegistry.ToolEntry(
        name: "open_url",
        tool: Tool(
            name: "open_url",
            description: "Open a URL in the simulator (launches the appropriate app to handle the URL scheme)",
            inputSchema: .objectSchema(
                properties: [
                    "url": .stringProperty("The URL to open (e.g. https://example.com or myapp://deep-link)", maxLength: 2048),
                    "udid": .udidProperty,
                ],
                required: ["url"]
            )
        )
    )

    static let sendPush = ToolRegistry.ToolEntry(
        name: "send_push",
        tool: Tool(
            name: "send_push",
            description: "Send a simulated push notification to an app on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "bundle_id": .stringProperty("The bundle identifier of the app", maxLength: 256),
                    "payload": .stringProperty("Push notification payload as JSON string"),
                    "payload_path": .stringProperty("Path to a JSON file containing the push payload", maxLength: 1024),
                    "udid": .udidProperty,
                ],
                required: ["bundle_id"]
            )
        )
    )

    static let addMedia = ToolRegistry.ToolEntry(
        name: "add_media",
        tool: Tool(
            name: "add_media",
            description: "Add photos or videos to the simulator's photo library",
            inputSchema: .objectSchema(
                properties: [
                    "paths": .object([
                        "type": "array",
                        "description": .string("Array of file paths to add"),
                        "items": .object(["type": "string"]),
                    ]),
                    "udid": .udidProperty,
                ],
                required: ["paths"]
            )
        )
    )

    static let setStatusBar = ToolRegistry.ToolEntry(
        name: "set_status_bar",
        tool: Tool(
            name: "set_status_bar",
            description: "Override the simulator status bar with custom values (time, battery, signal, etc.)",
            inputSchema: .objectSchema(properties: [
                "time": .stringProperty("Override the time (e.g. '9:41')"),
                "battery_level": .integerProperty("Battery level (0-100)", minimum: 0, maximum: 100),
                "battery_state": .enumProperty("Battery state", values: ["charging", "charged", "discharging"]),
                "cellular_bars": .integerProperty("Cellular signal bars (0-4)", minimum: 0, maximum: 4),
                "wifi_bars": .integerProperty("WiFi signal bars (0-3)", minimum: 0, maximum: 3),
                "operator_name": .stringProperty("Cellular operator name"),
                "udid": .udidProperty,
            ])
        )
    )

    static let clearStatusBar = ToolRegistry.ToolEntry(
        name: "clear_status_bar",
        tool: Tool(
            name: "clear_status_bar",
            description: "Clear all status bar overrides and restore defaults",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleSetAppearance(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let appearance = args.string("appearance") else {
            throw SimctlError.commandFailed("set_appearance", "appearance is required (light or dark)")
        }
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.setAppearance(udid: udid, appearance: appearance)
        return [.text("Appearance set to \(appearance)")]
    }

    func handleGetAppearance(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        let appearance = try await simctl.getAppearance(udid: udid)
        return [.text("Current appearance: \(appearance)")]
    }

    func handleSetLocation(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let latitude = args.double("latitude"),
              let longitude = args.double("longitude")
        else {
            throw SimctlError.commandFailed("set_location", "latitude and longitude are required")
        }
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.setLocation(udid: udid, latitude: latitude, longitude: longitude)
        return [.text("Location set to (\(latitude), \(longitude))")]
    }

    func handleClearLocation(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.clearLocation(udid: udid)
        return [.text("Location cleared")]
    }

    func handleSetPrivacy(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let action = args.string("action"),
              let service = args.string("service"),
              let bundleID = args.string("bundle_id")
        else {
            throw SimctlError.commandFailed("set_privacy", "action, service, and bundle_id are required")
        }
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.setPrivacy(udid: udid, action: action, service: service, bundleID: bundleID)
        return [.text("Privacy: \(action) \(service) for \(bundleID)")]
    }

    func handleOpenURL(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let url = args.string("url") else {
            throw SimctlError.commandFailed("open_url", "url is required")
        }
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.openURL(udid: udid, url: url)
        return [.text("Opened URL: \(url)")]
    }

    func handleSendPush(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let bundleID = args.string("bundle_id") else {
            throw SimctlError.commandFailed("send_push", "bundle_id is required")
        }

        let udid = try await simctl.resolveUDID(args.string("udid"))
        var payloadPath: String

        if let inlinePayload = args.string("payload") {
            // Write inline JSON to temp file
            guard let tmpDir = tempDir else {
                throw SimctlError.commandFailed("send_push", "Temp directory not available")
            }
            payloadPath = "\(tmpDir)/push_\(UUID().uuidString).json"
            try inlinePayload.write(toFile: payloadPath, atomically: true, encoding: .utf8)
        } else if let path = args.string("payload_path") {
            payloadPath = NSString(string: path).expandingTildeInPath
        } else {
            throw SimctlError.commandFailed("send_push", "Either payload or payload_path is required")
        }

        try await simctl.sendPushNotification(udid: udid, bundleID: bundleID, payloadPath: payloadPath)
        return [.text("Push notification sent to \(bundleID)")]
    }

    func handleAddMedia(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let paths = args.stringArray("paths"), !paths.isEmpty else {
            throw SimctlError.commandFailed("add_media", "paths array is required and must not be empty")
        }

        let expanded = paths.map { NSString(string: $0).expandingTildeInPath }

        // Verify files exist
        for path in expanded {
            guard FileManager.default.fileExists(atPath: path) else {
                throw SimctlError.commandFailed("add_media", "File not found: \(path)")
            }
        }

        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.addMedia(udid: udid, paths: expanded)
        return [.text("Added \(expanded.count) media file(s) to photo library")]
    }

    func handleSetStatusBar(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))

        var overrides: [String] = []
        if let time = args.string("time") {
            overrides.append(contentsOf: ["--time", time])
        }
        if let level = args.int("battery_level") {
            overrides.append(contentsOf: ["--batteryLevel", String(level)])
        }
        if let state = args.string("battery_state") {
            overrides.append(contentsOf: ["--batteryState", state])
        }
        if let bars = args.int("cellular_bars") {
            overrides.append(contentsOf: ["--cellularBars", String(bars)])
        }
        if let bars = args.int("wifi_bars") {
            overrides.append(contentsOf: ["--wifiBars", String(bars)])
        }
        if let op = args.string("operator_name") {
            overrides.append(contentsOf: ["--operatorName", op])
        }

        guard !overrides.isEmpty else {
            return [.text("No status bar overrides specified")]
        }

        try await simctl.setStatusBar(udid: udid, overrides: overrides)
        return [.text("Status bar updated")]
    }

    func handleClearStatusBar(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.clearStatusBar(udid: udid)
        return [.text("Status bar overrides cleared")]
    }
}
