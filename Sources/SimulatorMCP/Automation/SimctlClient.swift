import Foundation

/// Swift wrapper around `xcrun simctl` commands.
/// Uses `CommandExecuting` protocol for testability — inject a mock in tests.
actor SimctlClient {
    private let xcrunPath = "/usr/bin/xcrun"
    private let executor: CommandExecuting

    init(executor: CommandExecuting = ProcessCommandExecutor()) {
        self.executor = executor
    }

    // MARK: - Command Execution

    /// Execute an xcrun simctl command with the given arguments.
    func run(_ arguments: String...) async throws -> CommandResult {
        try await run(arguments)
    }

    /// Execute an xcrun simctl command with an array of arguments.
    func run(_ arguments: [String]) async throws -> CommandResult {
        try await executor.execute(executablePath: xcrunPath, arguments: ["simctl"] + arguments)
    }

    /// Execute an arbitrary command (not simctl).
    func runCommand(_ executablePath: String, arguments: [String]) async throws -> CommandResult {
        try await executor.execute(executablePath: executablePath, arguments: arguments)
    }

    // MARK: - Device Listing & Discovery

    /// List all simulator devices, optionally filtering by state.
    func listDevices() async throws -> [SimDevice] {
        let result = try await run("list", "devices", "--json")
        guard result.succeeded else {
            throw SimctlError.commandFailed("simctl list devices", result.stderr)
        }
        return try Self.parseDeviceList(result.stdout)
    }

    /// Parse simctl device list JSON output into SimDevice array.
    /// Static for testability — can be called without an actor instance.
    static func parseDeviceList(_ json: String) throws -> [SimDevice] {
        guard let data = json.data(using: .utf8) else {
            throw SimctlError.parseError("Failed to decode JSON string")
        }

        let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let devicesByRuntime = parsed?["devices"] as? [String: [[String: Any]]] else {
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
        guard result.succeeded else {
            throw SimctlError.commandFailed("boot", result.stderr)
        }
    }

    func shutdownDevice(_ udid: String) async throws {
        let result = try await run("shutdown", udid)
        guard result.succeeded else {
            throw SimctlError.commandFailed("shutdown", result.stderr)
        }
    }

    func eraseDevice(_ udid: String) async throws {
        let result = try await run("erase", udid)
        guard result.succeeded else {
            throw SimctlError.commandFailed("erase", result.stderr)
        }
    }

    func openSimulatorApp() async throws {
        let result = try await runCommand("/usr/bin/open", arguments: ["-a", "Simulator.app"])
        guard result.succeeded else {
            throw SimctlError.commandFailed("open Simulator.app", result.stderr)
        }
    }

    // MARK: - App Management

    func installApp(udid: String, path: String) async throws {
        let result = try await run("install", udid, "--", path)
        guard result.succeeded else {
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
        guard result.succeeded else {
            throw SimctlError.commandFailed("launch", result.stderr)
        }

        // Extract PID from output like "com.example.app: 12345"
        return Self.extractPID(from: result.stdout)
    }

    /// Extract PID from simctl launch output. Static for testability.
    static func extractPID(from output: String) -> String? {
        if let range = output.range(of: #": (\d+)"#, options: .regularExpression) {
            let pidStr = output[range].dropFirst(2)
            return String(pidStr)
        }
        return nil
    }

    func terminateApp(udid: String, bundleID: String) async throws {
        let result = try await run("terminate", udid, "--", bundleID)
        guard result.succeeded else {
            throw SimctlError.commandFailed("terminate", result.stderr)
        }
    }

    func getAppContainer(udid: String, bundleID: String, container: String = "app") async throws -> String {
        let result = try await run("get_app_container", udid, bundleID, container)
        guard result.succeeded else {
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
        guard result.succeeded || combinedOutput.contains("Wrote screenshot to") else {
            throw SimctlError.commandFailed("screenshot", result.stderr)
        }
    }

    /// Start video recording. Returns the Process so it can be stopped later.
    /// Note: This bypasses CommandExecuting since it needs a long-running Process handle.
    func startRecording(udid: String, outputPath: String, codec: String = "hevc", display: String? = nil, mask: String? = nil, force: Bool = false) async throws -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: xcrunPath)
        var args = ["simctl", "io", udid, "recordVideo"]
        args.append("--codec=\(codec)")
        if let display = display { args.append("--display=\(display)") }
        if let mask = mask { args.append("--mask=\(mask)") }
        if force { args.append("--force") }
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
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        }

        return process
    }

    /// Stop video recording by sending SIGINT to simctl recordVideo processes.
    func stopRecording() async throws {
        let result = try await runCommand("/usr/bin/pkill", arguments: ["-SIGINT", "-f", "simctl.*recordVideo"])
        try await Task.sleep(nanoseconds: 1_000_000_000)
        if !result.succeeded {
            throw SimctlError.commandFailed("stop recording", "No active recording found")
        }
    }

    // MARK: - Device Control

    func setStatusBar(udid: String, overrides: [String]) async throws {
        var args = ["status_bar", udid, "override"]
        args.append(contentsOf: overrides)
        let result = try await run(args)
        guard result.succeeded else {
            throw SimctlError.commandFailed("status_bar", result.stderr)
        }
    }

    func clearStatusBar(udid: String) async throws {
        let result = try await run("status_bar", udid, "clear")
        guard result.succeeded else { throw SimctlError.commandFailed("status_bar clear", result.stderr) }
    }

    func setLocation(udid: String, latitude: Double, longitude: Double) async throws {
        let result = try await run("location", udid, "set", "\(latitude),\(longitude)")
        guard result.succeeded else { throw SimctlError.commandFailed("location", result.stderr) }
    }

    func clearLocation(udid: String) async throws {
        let result = try await run("location", udid, "clear")
        guard result.succeeded else { throw SimctlError.commandFailed("location clear", result.stderr) }
    }

    func setPrivacy(udid: String, action: String, service: String, bundleID: String) async throws {
        let result = try await run("privacy", udid, action, service, "--", bundleID)
        guard result.succeeded else { throw SimctlError.commandFailed("privacy", result.stderr) }
    }

    func sendPushNotification(udid: String, bundleID: String, payloadPath: String) async throws {
        let result = try await run("push", udid, bundleID, "--", payloadPath)
        guard result.succeeded else { throw SimctlError.commandFailed("push", result.stderr) }
    }

    func openURL(udid: String, url: String) async throws {
        let result = try await run("openurl", udid, "--", url)
        guard result.succeeded else { throw SimctlError.commandFailed("openurl", result.stderr) }
    }

    func addMedia(udid: String, paths: [String]) async throws {
        var args = ["addmedia", udid, "--"]
        args.append(contentsOf: paths)
        let result = try await run(args)
        guard result.succeeded else { throw SimctlError.commandFailed("addmedia", result.stderr) }
    }

    func setAppearance(udid: String, appearance: String) async throws {
        let result = try await run("ui", udid, "appearance", appearance)
        guard result.succeeded else { throw SimctlError.commandFailed("ui appearance", result.stderr) }
    }

    func getAppearance(udid: String) async throws -> String {
        let result = try await run("ui", udid, "appearance")
        guard result.succeeded else { throw SimctlError.commandFailed("ui appearance", result.stderr) }
        return result.stdout
    }
}

// MARK: - Errors

enum SimctlError: Error, CustomStringConvertible, Equatable {
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
