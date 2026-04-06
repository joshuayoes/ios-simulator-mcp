import Foundation

/// Client that communicates with the XCUITest runner deployed to the simulator.
/// Replaces IDBClient by sending JSON commands over HTTP to the embedded test server.
///
/// Architecture (inspired by callstackincubator/agent-device):
/// 1. The MCP server deploys an XCUITest bundle to the simulator via `xcodebuild test-without-building`
/// 2. The test bundle starts an NWListener HTTP server on a random port
/// 3. The port is discovered by parsing the xcodebuild output for "SIMULATOR_MCP_RUNNER_PORT=<port>"
/// 4. All UI commands (tap, type, swipe, snapshot) are sent as JSON POST requests
///
/// This eliminates the dependency on Facebook's idb entirely.
actor XCTestRunnerClient {
    private var runnerProcess: Process?
    private var runnerPort: Int?
    private let simctl: SimctlClient

    /// Path to the pre-built .xctestrun file. Set via environment variable or auto-detected.
    private let xctestrunPath: String?

    init(simctl: SimctlClient) {
        self.simctl = simctl

        // Check for pre-built runner path
        if let path = ProcessInfo.processInfo.environment["IOS_SIMULATOR_MCP_RUNNER_PATH"] {
            self.xctestrunPath = NSString(string: path).expandingTildeInPath
        } else {
            // Look for the runner in the build directory relative to the executable
            let execURL = Bundle.main.executableURL ?? URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])
            let buildDir = execURL.deletingLastPathComponent().path
            let candidatePath = "\(buildDir)/../XCTestRunner/SimulatorMCPRunner.xctestrun"
            if FileManager.default.fileExists(atPath: candidatePath) {
                self.xctestrunPath = candidatePath
            } else {
                self.xctestrunPath = nil
            }
        }
    }

    // MARK: - Runner Lifecycle

    /// Ensure the XCTest runner is running on the given simulator.
    /// If already running and healthy, returns immediately.
    func ensureRunning(udid: String) async throws {
        // Check if already connected and healthy
        if let port = runnerPort, await isHealthy(port: port) {
            return
        }

        // Start the runner
        try await startRunner(udid: udid)
    }

    /// Start the XCTest runner on the given simulator.
    private func startRunner(udid: String) async throws {
        guard let xctestrunPath = xctestrunPath else {
            throw XCTestRunnerError.runnerNotFound(
                "XCTest runner not found. Build it with: cd Sources/XCTestRunner && ./build-runner.sh\n" +
                "Or set IOS_SIMULATOR_MCP_RUNNER_PATH to the .xctestrun file path."
            )
        }

        // Kill any existing runner
        stopRunner()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = [
            "xcodebuild", "test-without-building",
            "-xctestrun", xctestrunPath,
            "-destination", "platform=iOS Simulator,id=\(udid)",
            "-only-testing", "SimulatorMCPRunnerUITests/CommandServerTest/testCommand",
        ]

        let stderrPipe = Pipe()
        let stdoutPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()
        self.runnerProcess = process

        // Watch for the port announcement in the output
        let port = try await discoverPort(stdout: stdoutPipe, stderr: stderrPipe, timeout: 30.0)
        self.runnerPort = port
    }

    /// Discover the runner's port by scanning the xcodebuild output.
    private func discoverPort(stdout: Pipe, stderr: Pipe, timeout: TimeInterval) async throws -> Int {
        let deadline = Date().addingTimeInterval(timeout)
        let portPattern = "SIMULATOR_MCP_RUNNER_PORT="

        // Read output in a background task looking for the port line
        return try await withCheckedThrowingContinuation { continuation in
            var resumed = false

            // Monitor both stdout and stderr (xcodebuild logs can go to either)
            let monitor = { (pipe: Pipe) in
                pipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    guard !data.isEmpty, let output = String(data: data, encoding: .utf8) else { return }

                    for line in output.components(separatedBy: .newlines) {
                        if let range = line.range(of: portPattern) {
                            let portStr = line[range.upperBound...]
                            if let port = Int(portStr.trimmingCharacters(in: .whitespacesAndNewlines)), !resumed {
                                resumed = true
                                continuation.resume(returning: port)
                            }
                        }
                    }
                }
            }

            monitor(stdout)
            monitor(stderr)

            // Timeout handler
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if !resumed {
                    resumed = true
                    continuation.resume(throwing: XCTestRunnerError.startTimeout)
                }
            }
        }
    }

    /// Stop the XCTest runner process.
    func stopRunner() {
        runnerProcess?.terminate()
        runnerProcess = nil
        runnerPort = nil
    }

    /// Check if the runner is responding to health checks.
    private func isHealthy(port: Int) async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return false }
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    // MARK: - Command Execution

    /// Send a command to the runner and return the parsed result.
    private func sendCommand(_ command: String, params: [String: Any] = [:], udid: String? = nil) async throws -> [String: Any] {
        // Ensure runner is running
        let resolvedUDID = try await simctl.resolveUDID(udid)
        try await ensureRunning(udid: resolvedUDID)

        guard let port = runnerPort else {
            throw XCTestRunnerError.notRunning
        }

        // Build request
        var body: [String: Any] = ["command": command, "params": params]
        let jsonData = try JSONSerialization.data(withJSONObject: body)

        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/command")!)
        request.httpMethod = "POST"
        request.httpBody = jsonData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw XCTestRunnerError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw XCTestRunnerError.invalidResponse
        }

        if let success = result["success"] as? Bool, !success {
            let errorMsg = result["error"] as? String ?? "Unknown runner error"
            throw XCTestRunnerError.commandFailed(errorMsg)
        }

        return result["result"] as? [String: Any] ?? [:]
    }

    // MARK: - UI Accessibility

    /// Get the full accessibility tree for the screen (replaces idb describe-all).
    func snapshot(udid: String? = nil, interactiveOnly: Bool = false) async throws -> String {
        let result = try await sendCommand("snapshot", params: [
            "interactive_only": interactiveOnly,
        ], udid: udid)

        // Convert to JSON string for compatibility
        let data = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    /// Get the accessibility element at a specific point (replaces idb describe-point).
    func describePoint(x: Double, y: Double, udid: String? = nil) async throws -> String {
        let result = try await sendCommand("describe_point", params: [
            "x": x,
            "y": y,
        ], udid: udid)

        let data = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    // MARK: - UI Interactions

    /// Tap at the given coordinates (replaces idb tap).
    func tap(x: Double, y: Double, duration: Double? = nil, udid: String? = nil) async throws {
        var params: [String: Any] = ["x": x, "y": y]
        if let duration = duration { params["duration"] = duration }
        _ = try await sendCommand("tap", params: params, udid: udid)
    }

    /// Double-tap at the given coordinates (new — not available via idb).
    func doubleTap(x: Double, y: Double, udid: String? = nil) async throws {
        _ = try await sendCommand("double_tap", params: ["x": x, "y": y], udid: udid)
    }

    /// Long press at the given coordinates (new — not available via idb).
    func longPress(x: Double, y: Double, duration: Double = 1.0, udid: String? = nil) async throws {
        _ = try await sendCommand("long_press", params: ["x": x, "y": y, "duration": duration], udid: udid)
    }

    /// Type text (replaces idb text). Now supports full Unicode!
    func typeText(_ text: String, identifier: String? = nil, udid: String? = nil) async throws {
        var params: [String: Any] = ["text": text]
        if let identifier = identifier { params["identifier"] = identifier }
        _ = try await sendCommand("type", params: params, udid: udid)
    }

    /// Swipe from one point to another (replaces idb swipe).
    func swipe(
        xStart: Double, yStart: Double,
        xEnd: Double, yEnd: Double,
        duration: Double? = nil,
        udid: String? = nil
    ) async throws {
        var params: [String: Any] = [
            "x_start": xStart, "y_start": yStart,
            "x_end": xEnd, "y_end": yEnd,
        ]
        if let duration = duration { params["duration"] = duration }
        _ = try await sendCommand("swipe", params: params, udid: udid)
    }

    /// Find an element by accessibility identifier or label (new — not available via idb).
    func findElement(identifier: String? = nil, label: String? = nil, udid: String? = nil) async throws -> String {
        var params: [String: Any] = [:]
        if let identifier = identifier { params["identifier"] = identifier }
        if let label = label { params["label"] = label }

        let result = try await sendCommand("find_element", params: params, udid: udid)
        let data = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    /// Press a hardware button (new — not available via idb).
    func pressButton(_ button: String, udid: String? = nil) async throws {
        _ = try await sendCommand("press_button", params: ["button": button], udid: udid)
    }
}

// MARK: - Errors

enum XCTestRunnerError: Error, CustomStringConvertible {
    case runnerNotFound(String)
    case startTimeout
    case notRunning
    case httpError(Int)
    case invalidResponse
    case commandFailed(String)

    var description: String {
        switch self {
        case .runnerNotFound(let msg): return msg
        case .startTimeout: return "XCTest runner failed to start within 30 seconds"
        case .notRunning: return "XCTest runner is not running"
        case .httpError(let code): return "Runner HTTP error: \(code)"
        case .invalidResponse: return "Invalid response from runner"
        case .commandFailed(let msg): return "Runner command failed: \(msg)"
        }
    }
}
