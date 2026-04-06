import Foundation

/// Swift wrapper around `xcrun simctl` commands.
/// Uses `Process` with `shell: false` semantics for security.
actor SimctlClient {
    private let xcrunPath = "/usr/bin/xcrun"

    // MARK: - Command Execution

    struct CommandResult: Sendable {
        let stdout: String
        let stderr: String
        let exitCode: Int32
    }

    /// Execute an xcrun simctl command with the given arguments.
    func run(_ arguments: String...) async throws -> CommandResult {
        try await run(arguments)
    }

    /// Execute an xcrun simctl command with an array of arguments.
    func run(_ arguments: [String]) async throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: xcrunPath)
        process.arguments = ["simctl"] + arguments

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

        return CommandResult(stdout: stdout, stderr: stderr, exitCode: process.terminationStatus)
    }

    /// Execute an arbitrary command (not simctl).
    func runCommand(_ executablePath: String, arguments: [String]) async throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments

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

        return CommandResult(stdout: stdout, stderr: stderr, exitCode: process.terminationStatus)
    }

    // MARK: - Device Listing & Discovery

    /// List all simulator devices, optionally filtering by state.
    func listDevices() async throws -> [SimDevice] {
        let result = try await run("list", "devices", "--json")
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("simctl list devices", result.stderr)
        }

        guard let data = result.stdout.data(using: .utf8) else {
            throw SimctlError.parseError("Failed to parse device list")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let devicesByRuntime = json?["devices"] as? [String: [[String: Any]]] else {
            throw SimctlError.parseError("Unexpected device list format")
        }

        var devices: [SimDevice] = []
        for (runtime, deviceList) in devicesByRuntime {
            for device in deviceList {
                guard let name = device["name"] as? String,
                      let udid = device["udid"] as? String,
                      let state = device["state"] as? String else { continue }
                let runtimeName = runtime
                    .replacingOccurrences(of: "com.apple.CoreSimulator.SimRuntime.", with: "")
                    .replacingOccurrences(of: "-", with: " ")
                    .replacingOccurrences(of: "  ", with: " - ", options: [], range: nil)
                devices.append(SimDevice(name: name, udid: udid, state: state, runtime: runtimeName))
            }
        }
        return devices
    }

    /// Get the currently booted simulator device.
    func getBootedDevice() async throws -> SimDevice {
        let devices = try await listDevices()
        guard let booted = devices.first(where: { $0.isBooted }) else {
            throw SimctlError.noBootedDevice
        }
        return booted
    }

    /// Resolve a UDID: use provided one or fall back to booted device.
    func resolveUDID(_ udid: String?) async throws -> String {
        if let udid = udid {
            return udid
        }
        return try await getBootedDevice().udid
    }

    // MARK: - Simulator Lifecycle

    func bootDevice(_ udid: String) async throws {
        let result = try await run("boot", udid)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("boot", result.stderr)
        }
    }

    func shutdownDevice(_ udid: String) async throws {
        let result = try await run("shutdown", udid)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("shutdown", result.stderr)
        }
    }

    func eraseDevice(_ udid: String) async throws {
        let result = try await run("erase", udid)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("erase", result.stderr)
        }
    }

    func openSimulatorApp() async throws {
        let result = try await runCommand("/usr/bin/open", arguments: ["-a", "Simulator.app"])
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("open Simulator.app", result.stderr)
        }
    }

    // MARK: - App Management

    func installApp(udid: String, path: String) async throws {
        let result = try await run("install", udid, "--", path)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("install", result.stderr)
        }
    }

    func launchApp(udid: String, bundleID: String, terminateExisting: Bool = false) async throws -> String? {
        var args = ["launch"]
        if terminateExisting {
            args.append("--terminate-running-process")
        }
        args.append(udid)
        args.append("--")
        args.append(bundleID)

        let result = try await run(args)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("launch", result.stderr)
        }

        // Extract PID from output like "com.example.app: 12345"
        if let range = result.stdout.range(of: #": (\d+)"#, options: .regularExpression) {
            let pidStr = result.stdout[range].dropFirst(2)
            return String(pidStr)
        }
        return nil
    }

    func terminateApp(udid: String, bundleID: String) async throws {
        let result = try await run("terminate", udid, "--", bundleID)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("terminate", result.stderr)
        }
    }

    func getAppContainer(udid: String, bundleID: String, container: String = "app") async throws -> String {
        let result = try await run("get_app_container", udid, bundleID, container)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("get_app_container", result.stderr)
        }
        return result.stdout
    }

    // MARK: - I/O Operations

    func screenshot(udid: String, outputPath: String, type: String = "png", display: String? = nil, mask: String? = nil) async throws {
        var args = ["io", udid, "screenshot"]
        args.append("--type=\(type)")
        if let display = display {
            args.append("--display=\(display)")
        }
        if let mask = mask {
            args.append("--mask=\(mask)")
        }
        args.append("--")
        args.append(outputPath)

        let result = try await run(args)
        // simctl screenshot outputs success message to stderr
        let combinedOutput = result.stdout + result.stderr
        guard result.exitCode == 0 || combinedOutput.contains("Wrote screenshot to") else {
            throw SimctlError.commandFailed("screenshot", result.stderr)
        }
    }

    /// Start video recording. Returns the Process so it can be stopped later.
    func startRecording(udid: String, outputPath: String, codec: String = "hevc", display: String? = nil, mask: String? = nil, force: Bool = false) async throws -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: xcrunPath)
        var args = ["simctl", "io", udid, "recordVideo"]
        args.append("--codec=\(codec)")
        if let display = display {
            args.append("--display=\(display)")
        }
        if let mask = mask {
            args.append("--mask=\(mask)")
        }
        if force {
            args.append("--force")
        }
        args.append("--")
        args.append(outputPath)
        process.arguments = args

        let stderrPipe = Pipe()
        process.standardError = stderrPipe

        try process.run()

        // Wait for "Recording started" message (up to 3 seconds)
        let deadline = Date().addingTimeInterval(3.0)
        var started = false
        while Date() < deadline && !started {
            let data = stderrPipe.fileHandleForReading.availableData
            if let output = String(data: data, encoding: .utf8), output.contains("Recording started") {
                started = true
            }
            if !started {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            }
        }

        return process
    }

    /// Stop video recording by sending SIGINT to simctl recordVideo processes.
    func stopRecording() async throws {
        let result = try await runCommand("/usr/bin/pkill", arguments: ["-SIGINT", "-f", "simctl.*recordVideo"])
        // Give time for video finalization
        try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        if result.exitCode != 0 {
            throw SimctlError.commandFailed("stop recording", "No active recording found")
        }
    }

    // MARK: - Device Control

    func setStatusBar(udid: String, overrides: [String]) async throws {
        var args = ["status_bar", udid, "override"]
        args.append(contentsOf: overrides)
        let result = try await run(args)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("status_bar", result.stderr)
        }
    }

    func clearStatusBar(udid: String) async throws {
        let result = try await run("status_bar", udid, "clear")
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("status_bar clear", result.stderr)
        }
    }

    func setLocation(udid: String, latitude: Double, longitude: Double) async throws {
        let result = try await run("location", udid, "set", "\(latitude),\(longitude)")
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("location", result.stderr)
        }
    }

    func clearLocation(udid: String) async throws {
        let result = try await run("location", udid, "clear")
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("location clear", result.stderr)
        }
    }

    func setPrivacy(udid: String, action: String, service: String, bundleID: String) async throws {
        let result = try await run("privacy", udid, action, service, "--", bundleID)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("privacy", result.stderr)
        }
    }

    func sendPushNotification(udid: String, bundleID: String, payloadPath: String) async throws {
        let result = try await run("push", udid, bundleID, "--", payloadPath)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("push", result.stderr)
        }
    }

    func openURL(udid: String, url: String) async throws {
        let result = try await run("openurl", udid, "--", url)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("openurl", result.stderr)
        }
    }

    func addMedia(udid: String, paths: [String]) async throws {
        var args = ["addmedia", udid, "--"]
        args.append(contentsOf: paths)
        let result = try await run(args)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("addmedia", result.stderr)
        }
    }

    func setAppearance(udid: String, appearance: String) async throws {
        let result = try await run("ui", udid, "appearance", appearance)
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("ui appearance", result.stderr)
        }
    }

    func getAppearance(udid: String) async throws -> String {
        let result = try await run("ui", udid, "appearance")
        guard result.exitCode == 0 else {
            throw SimctlError.commandFailed("ui appearance", result.stderr)
        }
        return result.stdout
    }
}

// MARK: - Errors

enum SimctlError: Error, CustomStringConvertible {
    case commandFailed(String, String)
    case noBootedDevice
    case parseError(String)

    var description: String {
        switch self {
        case .commandFailed(let command, let stderr):
            return "simctl \(command) failed: \(stderr)"
        case .noBootedDevice:
            return "No booted simulator found. Please boot a simulator first using Xcode or `xcrun simctl boot`."
        case .parseError(let message):
            return "Parse error: \(message)"
        }
    }
}
