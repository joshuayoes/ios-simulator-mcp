import Foundation

/// Swift wrapper around Facebook's `idb` (iOS Development Bridge) for UI automation.
/// IDB is required for UI interactions (tap, type, swipe) and accessibility tree inspection.
actor IDBClient {
    private var idbPath: String

    init() {
        // Check environment variable first, then fall back to PATH
        if let envPath = ProcessInfo.processInfo.environment["IOS_SIMULATOR_MCP_IDB_PATH"] {
            let expanded = NSString(string: envPath).expandingTildeInPath
            self.idbPath = expanded
        } else {
            self.idbPath = "idb"
        }
    }

    /// Check if idb is available.
    func isAvailable() async -> Bool {
        do {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
            process.arguments = [idbPath]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    // MARK: - Command Execution

    private func run(_ arguments: [String]) async throws -> String {
        let process = Process()

        if idbPath.contains("/") {
            process.executableURL = URL(fileURLWithPath: idbPath)
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [idbPath] + arguments
        }

        if idbPath.contains("/") {
            process.arguments = arguments
        }

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        let stdout = String(data: stdoutData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let stderr = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard process.terminationStatus == 0 else {
            throw IDBError.commandFailed(stderr.isEmpty ? stdout : stderr)
        }

        return stdout
    }

    // MARK: - UI Accessibility

    /// Get the full accessibility tree for the screen.
    func describeAll(udid: String? = nil) async throws -> String {
        var args = ["ui", "describe-all", "--json", "--nested"]
        if let udid = udid {
            args.append(contentsOf: ["--udid", udid])
        }
        return try await run(args)
    }

    /// Get the accessibility element at a specific point.
    func describePoint(x: Double, y: Double, udid: String? = nil) async throws -> String {
        var args = ["ui", "describe-point"]
        if let udid = udid {
            args.append(contentsOf: ["--udid", udid])
        }
        args.append("--json")
        args.append("--")
        args.append(String(x))
        args.append(String(y))
        return try await run(args)
    }

    // MARK: - UI Interactions

    /// Tap at the given coordinates.
    func tap(x: Double, y: Double, duration: Double? = nil, udid: String? = nil) async throws {
        var args = ["ui", "tap"]
        if let udid = udid {
            args.append(contentsOf: ["--udid", udid])
        }
        if let duration = duration {
            args.append(contentsOf: ["--duration", String(duration)])
        }
        args.append("--")
        args.append(String(x))
        args.append(String(y))
        _ = try await run(args)
    }

    /// Type text into the focused input field.
    func typeText(_ text: String, udid: String? = nil) async throws {
        var args = ["ui", "text"]
        if let udid = udid {
            args.append(contentsOf: ["--udid", udid])
        }
        args.append("--")
        args.append(text)
        _ = try await run(args)
    }

    /// Swipe from one point to another.
    func swipe(
        xStart: Double, yStart: Double,
        xEnd: Double, yEnd: Double,
        duration: Double? = nil,
        delta: Int = 1,
        udid: String? = nil
    ) async throws {
        var args = ["ui", "swipe"]
        if let udid = udid {
            args.append(contentsOf: ["--udid", udid])
        }
        if let duration = duration {
            args.append(contentsOf: ["--duration", String(duration)])
        }
        args.append(contentsOf: ["--delta", String(delta)])
        args.append("--")
        args.append(String(xStart))
        args.append(String(yStart))
        args.append(String(xEnd))
        args.append(String(yEnd))
        _ = try await run(args)
    }
}

enum IDBError: Error, CustomStringConvertible {
    case commandFailed(String)
    case notAvailable

    var description: String {
        switch self {
        case .commandFailed(let message):
            return "idb command failed: \(message)"
        case .notAvailable:
            return "idb is not installed. Install it with: brew install idb-companion"
        }
    }
}
