import Foundation
import MCP

/// Central registry of all MCP tool definitions.
/// Each tool is defined with its name, description, and JSON Schema for input validation.
enum ToolRegistry {
    struct ToolEntry: Sendable {
        let name: String
        let tool: Tool
    }

    static let allTools: [ToolEntry] = [
        // Simulator Lifecycle
        SimulatorTools.getBootedSimId,
        SimulatorTools.listSimulators,
        SimulatorTools.openSimulator,
        SimulatorTools.bootSimulator,
        SimulatorTools.shutdownSimulator,

        // UI Interaction
        UITools.uiDescribeAll,
        UITools.uiDescribePoint,
        UITools.uiTap,
        UITools.uiType,
        UITools.uiSwipe,

        // Capture
        CaptureTools.uiView,
        CaptureTools.screenshot,
        CaptureTools.recordVideo,
        CaptureTools.stopRecording,

        // App Management
        AppTools.installApp,
        AppTools.launchApp,
        AppTools.terminateApp,

        // Device Control
        DeviceTools.setAppearance,
        DeviceTools.getAppearance,
        DeviceTools.setLocation,
        DeviceTools.clearLocation,
        DeviceTools.setPrivacy,
        DeviceTools.openURL,
        DeviceTools.sendPush,
        DeviceTools.addMedia,
        DeviceTools.setStatusBar,
        DeviceTools.clearStatusBar,
    ]
}

// MARK: - Value Helpers

/// Helper to build JSON Schema `Value` objects for tool input schemas.
extension Value {
    /// Create a string property schema.
    static func stringProperty(_ description: String, maxLength: Int? = nil, pattern: String? = nil) -> Value {
        var props: [String: Value] = [
            "type": "string",
            "description": .string(description),
        ]
        if let maxLength = maxLength {
            props["maxLength"] = .number(Double(maxLength))
        }
        if let pattern = pattern {
            props["pattern"] = .string(pattern)
        }
        return .object(props)
    }

    /// Create a number property schema.
    static func numberProperty(_ description: String, minimum: Double? = nil, maximum: Double? = nil) -> Value {
        var props: [String: Value] = [
            "type": "number",
            "description": .string(description),
        ]
        if let minimum = minimum {
            props["minimum"] = .number(minimum)
        }
        if let maximum = maximum {
            props["maximum"] = .number(maximum)
        }
        return .object(props)
    }

    /// Create an integer property schema.
    static func integerProperty(_ description: String, minimum: Int? = nil, maximum: Int? = nil) -> Value {
        var props: [String: Value] = [
            "type": "integer",
            "description": .string(description),
        ]
        if let minimum = minimum {
            props["minimum"] = .number(Double(minimum))
        }
        if let maximum = maximum {
            props["maximum"] = .number(Double(maximum))
        }
        return .object(props)
    }

    /// Create a boolean property schema.
    static func booleanProperty(_ description: String, defaultValue: Bool? = nil) -> Value {
        var props: [String: Value] = [
            "type": "boolean",
            "description": .string(description),
        ]
        if let defaultValue = defaultValue {
            props["default"] = .bool(defaultValue)
        }
        return .object(props)
    }

    /// Create an enum string property schema.
    static func enumProperty(_ description: String, values: [String], defaultValue: String? = nil) -> Value {
        var props: [String: Value] = [
            "type": "string",
            "description": .string(description),
            "enum": .array(values.map { .string($0) }),
        ]
        if let defaultValue = defaultValue {
            props["default"] = .string(defaultValue)
        }
        return .object(props)
    }

    /// Create an object schema with properties and required fields.
    static func objectSchema(properties: [String: Value], required: [String]? = nil) -> Value {
        var schema: [String: Value] = [
            "type": "object",
            "properties": .object(properties),
        ]
        if let required = required, !required.isEmpty {
            schema["required"] = .array(required.map { .string($0) })
        }
        return .object(schema)
    }

    /// UDID property schema used across all tools.
    static let udidProperty: Value = .stringProperty(
        "Simulator UDID (optional, defaults to booted device)",
        pattern: "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
    )
}

// MARK: - Argument Extraction Helpers

extension [String: Value] {
    func string(_ key: String) -> String? {
        self[key]?.stringValue
    }

    func double(_ key: String) -> Double? {
        self[key]?.doubleValue
    }

    func int(_ key: String) -> Int? {
        if let d = self[key]?.doubleValue {
            return Int(d)
        }
        return nil
    }

    func bool(_ key: String) -> Bool? {
        self[key]?.boolValue
    }

    func stringArray(_ key: String) -> [String]? {
        guard let arr = self[key]?.arrayValue else { return nil }
        return arr.compactMap { $0.stringValue }
    }
}

extension Value {
    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var doubleValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var arrayValue: [Value]? {
        if case .array(let a) = self { return a }
        return nil
    }
}
