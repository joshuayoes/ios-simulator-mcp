import Foundation
import MCP

// iOS Simulator MCP Server
// A Model Context Protocol server for controlling iOS Simulators.
// Provides tools for simulator lifecycle, UI interaction, screenshots,
// video recording, app management, and device control.

let server = SimulatorMCPServer()

// Handle SIGINT/SIGTERM for graceful cleanup
for sig: Int32 in [SIGINT, SIGTERM] {
    signal(sig) { _ in
        Task {
            await server.cleanup()
            exit(0)
        }
    }
}

do {
    let transport = StdioTransport()
    try await server.start(transport: transport)
} catch {
    FileHandle.standardError.write(Data("Error: \(error)\n".utf8))
    await server.cleanup()
    exit(1)
}
