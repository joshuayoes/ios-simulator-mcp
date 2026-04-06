import Foundation
import MCP

// MARK: - Tool Definitions

enum AppTools {
    static let installApp = ToolRegistry.ToolEntry(
        name: "install_app",
        tool: Tool(
            name: "install_app",
            description: "Install an app bundle (.app or .ipa) on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "app_path": .stringProperty("Path to the .app bundle or .ipa file to install", maxLength: 1024),
                    "udid": .udidProperty,
                ],
                required: ["app_path"]
            )
        )
    )

    static let launchApp = ToolRegistry.ToolEntry(
        name: "launch_app",
        tool: Tool(
            name: "launch_app",
            description: "Launch an app on the simulator by its bundle identifier",
            inputSchema: .objectSchema(
                properties: [
                    "bundle_id": .stringProperty("The bundle identifier of the app (e.g. com.apple.mobilesafari)", maxLength: 256),
                    "terminate_running": .booleanProperty("Terminate the running instance before launching", defaultValue: false),
                    "udid": .udidProperty,
                ],
                required: ["bundle_id"]
            )
        )
    )

    static let terminateApp = ToolRegistry.ToolEntry(
        name: "terminate_app",
        tool: Tool(
            name: "terminate_app",
            description: "Force-terminate a running app on the simulator",
            inputSchema: .objectSchema(
                properties: [
                    "bundle_id": .stringProperty("The bundle identifier of the app to terminate", maxLength: 256),
                    "udid": .udidProperty,
                ],
                required: ["bundle_id"]
            )
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleInstallApp(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let appPath = args.string("app_path") else {
            throw SimctlError.commandFailed("install_app", "app_path is required")
        }

        let expanded = NSString(string: appPath).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: expanded) else {
            throw SimctlError.commandFailed("install_app", "App bundle not found at: \(expanded)")
        }

        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.installApp(udid: udid, path: expanded)
        return [.text("App installed successfully from \(expanded)")]
    }

    func handleLaunchApp(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let bundleID = args.string("bundle_id") else {
            throw SimctlError.commandFailed("launch_app", "bundle_id is required")
        }

        let terminateRunning = args.bool("terminate_running") ?? false
        let udid = try await simctl.resolveUDID(args.string("udid"))

        let pid = try await simctl.launchApp(
            udid: udid,
            bundleID: bundleID,
            terminateExisting: terminateRunning
        )

        if let pid = pid {
            return [.text("App \(bundleID) launched with PID \(pid)")]
        }
        return [.text("App \(bundleID) launched successfully")]
    }

    func handleTerminateApp(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let bundleID = args.string("bundle_id") else {
            throw SimctlError.commandFailed("terminate_app", "bundle_id is required")
        }

        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.terminateApp(udid: udid, bundleID: bundleID)
        return [.text("App \(bundleID) terminated")]
    }
}
