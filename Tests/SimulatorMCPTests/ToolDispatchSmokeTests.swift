import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Smoke tests that verify every registered tool can be dispatched without panicking.
/// Inspired by XcodeBuildMCP's pattern: call every tool with empty args, assert all
/// return a response (even if it's an error for missing required params).
///
/// This serves as a contribution gate — adding a new tool that panics or isn't wired
/// up in the dispatch switch will be caught here.
@Suite("Tool Dispatch Smoke Tests")
struct ToolDispatchSmokeTests {

    static func makeServer() -> SimulatorMCPServer {
        let executor = MockCommandExecutor()
        // Stub common commands so simctl-based tools don't crash on missing stubs
        executor.stubSuccess(matching: "list", stdout: #"{"devices":{}}"#)
        executor.stubSuccess(matching: "boot", stdout: "")
        executor.stubSuccess(matching: "shutdown", stdout: "")
        executor.stubSuccess(matching: "appearance", stdout: "light")
        executor.stubSuccess(matching: "location", stdout: "")
        executor.stubSuccess(matching: "privacy", stdout: "")
        executor.stubSuccess(matching: "openurl", stdout: "")
        executor.stubSuccess(matching: "status_bar", stdout: "")
        executor.stubSuccess(matching: "push", stdout: "")
        executor.stubSuccess(matching: "addmedia", stdout: "")
        executor.stubSuccess(matching: "install", stdout: "")
        executor.stubSuccess(matching: "launch", stdout: "com.example: 1")
        executor.stubSuccess(matching: "terminate", stdout: "")
        executor.stubSuccess(matching: "screenshot", stdout: "", stderr: "Wrote screenshot to /tmp/x.png")
        executor.stubSuccess(matching: "recordVideo", stdout: "")
        executor.stub(
            matcher: { path, _ in path.contains("open") },
            result: .success(CommandResult(stdout: "", stderr: "", exitCode: 0))
        )
        executor.stub(
            matcher: { path, _ in path.contains("pkill") },
            result: .success(CommandResult(stdout: "", stderr: "", exitCode: 0))
        )

        let simctl = SimctlClient(executor: executor)
        let runner = XCTestRunnerClient(simctl: simctl)
        return SimulatorMCPServer(simctl: simctl, runner: runner, defaultOutputDir: "/tmp/test-output")
    }

    @Test("every registered tool name is handled in the dispatch switch")
    func allToolsDispatched() async throws {
        let server = Self.makeServer()
        let toolNames = ToolRegistry.allTools.map { $0.name }

        for name in toolNames {
            // Call handleToolCall with empty args — we just want to verify
            // the dispatch doesn't fall through to "Unknown tool"
            let params = CallTool.Parameters(name: name, arguments: [:])
            let result = try await server.handleToolCall(params)

            // The response should NOT be "Unknown tool: ..."
            // It CAN be an error (missing required params), that's fine
            if let text = result.content.first?.text {
                #expect(
                    !text.contains("Unknown tool"),
                    "Tool '\(name)' is not wired up in the dispatch switch"
                )
            }
        }
    }

    @Test("unknown tool returns error message")
    func unknownToolHandled() async throws {
        let server = Self.makeServer()
        let params = CallTool.Parameters(name: "nonexistent_tool", arguments: [:])
        let result = try await server.handleToolCall(params)

        let text = result.content.first?.text ?? ""
        #expect(text.contains("Unknown tool"))
        #expect(!result.isError) // The outer handler catches this as text, not isError
    }

    // MARK: - Simctl-based tools return results (not runner-dependent)

    @Test("simctl-based tools respond successfully with empty args", arguments: [
        "open_simulator",
        "get_appearance",
        "clear_location",
        "clear_status_bar",
        "stop_recording",
    ])
    func simctlToolsRespond(toolName: String) async throws {
        let server = Self.makeServer()
        let params = CallTool.Parameters(name: toolName, arguments: [:])
        let result = try await server.handleToolCall(params)

        // These tools don't require arguments and should succeed with our stubs
        // (or return a non-crashing error)
        #expect(result.content.isEmpty == false, "Tool '\(toolName)' returned empty content")
    }

    @Test("list_simulators with empty args returns valid response")
    func listSimulatorsSmoke() async throws {
        let server = Self.makeServer()
        let params = CallTool.Parameters(name: "list_simulators", arguments: [:])
        let result = try await server.handleToolCall(params)
        #expect(result.isError == false)
    }
}

// MARK: - Tool.Content text helper

extension Tool.Content {
    /// Extract text from a Tool.Content for test assertions.
    var text: String? {
        // Tool.Content is an enum; check if it's a text case
        if case .text(let t) = self { return t }
        return nil
    }
}
