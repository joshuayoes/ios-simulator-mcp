import Foundation
import MCP

// MARK: - Tool Definitions

enum CaptureTools {
    static let uiView = ToolRegistry.ToolEntry(
        name: "ui_view",
        tool: Tool(
            name: "ui_view",
            description: "Get a compressed screenshot of the simulator screen as a base64-encoded JPEG image. Also returns the accessibility tree.",
            inputSchema: .objectSchema(properties: [
                "udid": .udidProperty,
            ])
        )
    )

    static let screenshot = ToolRegistry.ToolEntry(
        name: "screenshot",
        tool: Tool(
            name: "screenshot",
            description: "Take a screenshot of the simulator and save it to a file",
            inputSchema: .objectSchema(properties: [
                "output_path": .stringProperty("Output file path (absolute or relative to output dir)", maxLength: 1024),
                "type": .enumProperty("Image format", values: ["png", "tiff", "bmp", "gif", "jpeg"], defaultValue: "png"),
                "display": .enumProperty("Display to capture", values: ["internal", "external"]),
                "mask": .enumProperty("Mask for the status bar area", values: ["ignored", "alpha", "black"]),
                "udid": .udidProperty,
            ])
        )
    )

    static let recordVideo = ToolRegistry.ToolEntry(
        name: "record_video",
        tool: Tool(
            name: "record_video",
            description: "Start recording video of the simulator screen. Use stop_recording to stop.",
            inputSchema: .objectSchema(properties: [
                "output_path": .stringProperty("Output file path for the recording", maxLength: 1024),
                "codec": .enumProperty("Video codec", values: ["h264", "hevc"], defaultValue: "hevc"),
                "display": .enumProperty("Display to record", values: ["internal", "external"]),
                "mask": .enumProperty("Mask for the status bar area", values: ["ignored", "alpha", "black"]),
                "force": .booleanProperty("Overwrite existing file", defaultValue: false),
                "udid": .udidProperty,
            ])
        )
    )

    static let stopRecording = ToolRegistry.ToolEntry(
        name: "stop_recording",
        tool: Tool(
            name: "stop_recording",
            description: "Stop the current video recording of the simulator",
            inputSchema: .objectSchema(properties: [:])
        )
    )
}

// MARK: - Tool Handlers

extension SimulatorMCPServer {
    func handleUIView(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))

        // Get accessibility tree for dimensions and context
        let uiDescription = try await idb.describeAll(udid: udid)

        // Parse screen dimensions from the accessibility tree
        var screenWidth: Int?
        var screenHeight: Int?
        if let data = uiDescription.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let frame = json["frame"] as? [String: Any]
        {
            screenWidth = frame["width"] as? Int
            screenHeight = frame["height"] as? Int
        }

        // Take screenshot as PNG
        guard let tmpDir = tempDir else {
            throw SimctlError.commandFailed("ui_view", "Temp directory not available")
        }
        let pngPath = "\(tmpDir)/screenshot_\(UUID().uuidString).png"
        try await simctl.screenshot(udid: udid, outputPath: pngPath, type: "png")

        // Resize to point dimensions if available, then compress to JPEG
        if let width = screenWidth, let height = screenHeight {
            _ = try await simctl.runCommand(
                "/usr/bin/sips",
                arguments: ["-z", String(height), String(width), pngPath]
            )
        }

        let jpegPath = "\(tmpDir)/screenshot_\(UUID().uuidString).jpg"
        let sipsResult = try await simctl.runCommand(
            "/usr/bin/sips",
            arguments: ["-s", "format", "jpeg", "-s", "formatOptions", "80", pngPath, "--out", jpegPath]
        )
        guard sipsResult.exitCode == 0 else {
            throw SimctlError.commandFailed("ui_view", "Failed to compress screenshot: \(sipsResult.stderr)")
        }

        // Read and base64 encode
        let jpegData = try Data(contentsOf: URL(fileURLWithPath: jpegPath))
        let base64 = jpegData.base64EncodedString()

        // Clean up temp files
        try? FileManager.default.removeItem(atPath: pngPath)
        try? FileManager.default.removeItem(atPath: jpegPath)

        return [
            .image(data: base64, mimeType: "image/jpeg"),
            .text("Screenshot captured. Screen accessibility tree:\n\(uiDescription)"),
        ]
    }

    func handleScreenshot(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        let imageType = args.string("type") ?? "png"
        let display = args.string("display")
        let mask = args.string("mask")

        let rawPath = args.string("output_path") ?? "screenshot.\(imageType)"
        let outputPath = resolveOutputPath(rawPath)

        // Ensure parent directory exists
        let parentDir = (outputPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)

        try await simctl.screenshot(udid: udid, outputPath: outputPath, type: imageType, display: display, mask: mask)
        return [.text("Screenshot saved to \(outputPath)")]
    }

    func handleRecordVideo(_ args: [String: Value]) async throws -> [Tool.Content] {
        let udid = try await simctl.resolveUDID(args.string("udid"))
        let codec = args.string("codec") ?? "hevc"
        let display = args.string("display")
        let mask = args.string("mask")
        let force = args.bool("force") ?? false

        let rawPath = args.string("output_path") ?? "recording.mp4"
        let outputPath = resolveOutputPath(rawPath)

        // Ensure parent directory exists
        let parentDir = (outputPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)

        let process = try await simctl.startRecording(
            udid: udid,
            outputPath: outputPath,
            codec: codec,
            display: display,
            mask: mask,
            force: force
        )

        await setRecordingProcess(process)

        return [.text("Recording started. Output will be saved to \(outputPath). Use stop_recording to stop.")]
    }

    func handleStopRecording(_ args: [String: Value]) async throws -> [Tool.Content] {
        try await simctl.stopRecording()
        await setRecordingProcess(nil)
        return [.text("Recording stopped.")]
    }
}
