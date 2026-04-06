import Foundation
import MCP

// MARK: - Tool Definitions

enum SimulatorTools {
    static let getBootedSimId = ToolRegistry.ToolEntry(
        name: "get_booted_sim_id",
        tool: Tool(
            name: "get_booted_sim_id",
            description: "Get the UDID and name of the currently booted iOS Simulator",
            inputSchema: .objectSchema(properties: [:])
        )
    )

    static let listSimulators = ToolRegistry.ToolEntry(
        name: "list_simulators",
        tool: Tool(
            name: "list_simulators",
            description: "List all available iOS Simulators with their UDID, name, state, and runtime",
            inputSchema: .objectSchema(properties: [
                "state": .enumProperty("Filter by state", values: ["Booted", "Shutdown", "all"]),
            ])
        )
    )

    static let openSimulator = ToolRegistry.ToolEntry(
        name: "open_simulator",
        tool: Tool(
            name: "open_simulator",
            description: "Open the iOS Simulator application",
            inputSchema: .objectSchema(properties: [:])
        )
    )

    static let bootSimulator = ToolRegistry.ToolEntry(
        name: "boot_simulator",
        tool: Tool(
            name: "boot_simulator",
            description: "Boot a specific iOS Simulator by UDID",
            inputSchema: .objectSchema(
                properties: [
                    "udid": .stringProperty(
                        "The UDID of the simulator to boot",
                        pattern: "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
                    ),
                ],
                required: ["udid"]
            )
        )
    )

    static let shutdownSimulator = ToolRegistry.ToolEntry(
        name: "shutdown_simulator",
        tool: Tool(
            name: "shutdown_simulator",
            description: "Shut down a specific iOS Simulator by UDID, or the currently booted simulator",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleGetBootedSimId(_ args: [String: Value]) async throws -> [Tool.Content] {
        let device = try await simctl.getBootedDevice()
        return [.text("Booted simulator: \(device.name) (\(device.udid))")]
    }

    func handleListSimulators(_ args: [String: Value]) async throws -> [Tool.Content] {
        let stateFilter = args.string("state")
        var devices = try await simctl.listDevices()

        if let stateFilter = stateFilter, stateFilter != "all" {
            devices = devices.filter { $0.state == stateFilter }
        }

        if devices.isEmpty {
            return [.text("No simulators found.")]
        }

        var output = "Available Simulators:\n\n"
        let grouped = Dictionary(grouping: devices) { $0.runtime }
        for (runtime, devicesInRuntime) in grouped.sorted(by: { $0.key < $1.key }) {
            output += "-- \(runtime) --\n"
            for device in devicesInRuntime {
                let status = device.isBooted ? " [Booted]" : ""
                output += "  \(device.name) (\(device.udid))\(status)\n"
            }
            output += "\n"
        }

        return [.text(output)]
    }

    func handleOpenSimulator(_ args: [String: Value]) async throws -> [Tool.Content] {
        try await simctl.openSimulatorApp()
        return [.text("Simulator.app opened successfully.")]
    }

    func handleBootSimulator(_ args: [String: Value]) async throws -> [Tool.Content] {
        guard let udid = args.string("udid") else {
            throw SimctlError.commandFailed("boot", "UDID is required")
        }
        try await simctl.bootDevice(udid)
        return [.text("Simulator \(udid) booted successfully.")]
    }

    func handleShutdownSimulator(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        try await simctl.shutdownDevice(udid)
        return [.text("Simulator \(udid) shut down successfully.")]
    }
}
