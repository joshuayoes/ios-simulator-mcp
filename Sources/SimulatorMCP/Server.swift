import Foundation
import MCP

/// The main MCP server that registers all simulator tools and handles requests.
actor SimulatorMCPServer {
    let server: Server
    let simctl: SimctlClient
    let runner: XCTestRunnerClient
    let filteredTools: Set<String>
    let defaultOutputDir: String
    private var recordingProcess: Process?
    private(set) var tempDir: String?

    /// Production initializer — reads configuration from environment variables.
    init() {
        let simctl = SimctlClient()
        self.server = Server(
            name: "ios-simulator-mcp",
            version: "2.0.0",
            capabilities: .init(tools: .init(listChanged: false))
        )
        self.simctl = simctl
        self.runner = XCTestRunnerClient(simctl: simctl)

        // Parse filtered tools from environment
        if let filtered = ProcessInfo.processInfo.environment["IOS_SIMULATOR_MCP_FILTERED_TOOLS"] {
            self.filteredTools = Set(filtered.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) })
        } else {
            self.filteredTools = []
        }

        // Output directory for screenshots/recordings
        if let dir = ProcessInfo.processInfo.environment["IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR"] {
            self.defaultOutputDir = NSString(string: dir).expandingTildeInPath
        } else {
            self.defaultOutputDir = NSString(string: "~/Downloads").expandingTildeInPath
        }
    }

    /// Test initializer — accepts injected dependencies.
    init(simctl: SimctlClient, runner: XCTestRunnerClient, filteredTools: Set<String> = [], defaultOutputDir: String = "/tmp") {
        self.server = Server(
            name: "ios-simulator-mcp",
            version: "2.0.0",
            capabilities: .init(tools: .init(listChanged: false))
        )
        self.simctl = simctl
        self.runner = runner
        self.filteredTools = filteredTools
        self.defaultOutputDir = defaultOutputDir
    }

    // MARK: - Server Lifecycle

    func start(transport: any Transport) async throws {
        // Create temp directory
        let tmpDir = NSTemporaryDirectory() + "ios-simulator-mcp-\(ProcessInfo.processInfo.processIdentifier)"
        try FileManager.default.createDirectory(atPath: tmpDir, withIntermediateDirectories: true)
        self.tempDir = tmpDir

        registerHandlers()
        try await server.start(transport: transport)
        await server.waitUntilCompleted()
    }

    func cleanup() async {
        await runner.stopRunner()
        if let tempDir = tempDir {
            try? FileManager.default.removeItem(atPath: tempDir)
        }
    }

    func setRecordingProcess(_ process: Process?) {
        self.recordingProcess = process
    }

    // MARK: - Path Helpers

    func resolveOutputPath(_ path: String?) -> String {
        guard let path = path else {
            return defaultOutputDir
        }
        let expanded = NSString(string: path).expandingTildeInPath
        if expanded.hasPrefix("/") {
            return expanded
        }
        return (defaultOutputDir as NSString).appendingPathComponent(expanded)
    }

    // MARK: - Handler Registration

    private func registerHandlers() {
        let allTools = ToolRegistry.allTools
        let filtered = self.filteredTools

        server.withMethodHandler(ListTools.self) { _ in
            let tools = allTools
                .filter { !filtered.contains($0.name) }
                .map { $0.tool }
            return .init(tools: tools)
        }

        // Capture self for tool call handling
        let serverRef = self
        server.withMethodHandler(CallTool.self) { params in
            return try await serverRef.handleToolCall(params)
        }
    }

    // MARK: - Tool Dispatch

    func handleToolCall(_ params: CallTool.Parameters) async throws -> CallTool.Result {
        let name = params.name
        let args = params.arguments ?? [:]

        do {
            let content: [Tool.Content] = try await {
                switch name {
                // Simulator Lifecycle
                case "get_booted_sim_id":
                    return try await handleGetBootedSimId(args)
                case "list_simulators":
                    return try await handleListSimulators(args)
                case "open_simulator":
                    return try await handleOpenSimulator(args)
                case "boot_simulator":
                    return try await handleBootSimulator(args)
                case "shutdown_simulator":
                    return try await handleShutdownSimulator(args)

                // UI Interaction (via XCTest runner)
                case "ui_describe_all":
                    return try await handleUIDescribeAll(args)
                case "ui_describe_point":
                    return try await handleUIDescribePoint(args)
                case "ui_tap":
                    return try await handleUITap(args)
                case "ui_double_tap":
                    return try await handleUIDoubleTap(args)
                case "ui_long_press":
                    return try await handleUILongPress(args)
                case "ui_type":
                    return try await handleUIType(args)
                case "ui_swipe":
                    return try await handleUISwipe(args)
                case "ui_find_element":
                    return try await handleUIFindElement(args)
                case "ui_press_home":
                    return try await handleUIPressHome(args)

                // Capture
                case "ui_view":
                    return try await handleUIView(args)
                case "screenshot":
                    return try await handleScreenshot(args)
                case "record_video":
                    return try await handleRecordVideo(args)
                case "stop_recording":
                    return try await handleStopRecording(args)

                // App Management
                case "install_app":
                    return try await handleInstallApp(args)
                case "launch_app":
                    return try await handleLaunchApp(args)
                case "terminate_app":
                    return try await handleTerminateApp(args)

                // Device Control
                case "set_appearance":
                    return try await handleSetAppearance(args)
                case "get_appearance":
                    return try await handleGetAppearance(args)
                case "set_location":
                    return try await handleSetLocation(args)
                case "clear_location":
                    return try await handleClearLocation(args)
                case "set_privacy":
                    return try await handleSetPrivacy(args)
                case "open_url":
                    return try await handleOpenURL(args)
                case "send_push":
                    return try await handleSendPush(args)
                case "add_media":
                    return try await handleAddMedia(args)
                case "set_status_bar":
                    return try await handleSetStatusBar(args)
                case "clear_status_bar":
                    return try await handleClearStatusBar(args)

                default:
                    return [.text("Unknown tool: \(name)")]
                }
            }()

            return .init(content: content, isError: false)
        } catch {
            return .init(content: [.text("Error: \(error)")], isError: true)
        }
    }
}
