import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Tests for app management tool handlers.
@Suite("App Tool Handler Tests")
struct AppToolHandlerTests {

    static func makeServer() -> (SimulatorMCPServer, MockCommandExecutor) {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: """
        {"devices":{"r":[{"udid":"SIM-ID","name":"iPhone 16","state":"Booted"}]}}
        """)
        let simctl = SimctlClient(executor: executor)
        let runner = XCTestRunnerClient(simctl: simctl)
        let server = SimulatorMCPServer(simctl: simctl, runner: runner)
        return (server, executor)
    }

    // MARK: - install_app

    @Test("install_app requires app_path")
    func installAppMissingPath() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleInstallApp([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("app_path"))
        }
    }

    @Test("install_app verifies file exists before calling simctl")
    func installAppFileNotFound() async throws {
        let (server, executor) = Self.makeServer()
        do {
            _ = try await server.handleInstallApp(["app_path": .string("/nonexistent/path/app.app")])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("not found"))
        }
        // Should NOT have called simctl install since file doesn't exist
        let installCalls = executor.invocations.filter { $0.arguments.contains("install") }
        #expect(installCalls.isEmpty)
    }

    // MARK: - launch_app

    @Test("launch_app sends correct command")
    func launchApp() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "launch", stdout: "com.example.app: 42")

        let result = try await server.handleLaunchApp([
            "bundle_id": .string("com.example.app"),
        ])
        let text = result.first?.text ?? ""
        #expect(text.contains("com.example.app"))
        #expect(text.contains("42")) // PID

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("launch"))
        #expect(args.contains("com.example.app"))
    }

    @Test("launch_app requires bundle_id")
    func launchAppMissingBundleID() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleLaunchApp([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("bundle_id"))
        }
    }

    @Test("launch_app includes terminate flag when requested")
    func launchAppTerminate() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "launch", stdout: "com.example.app: 1")

        _ = try await server.handleLaunchApp([
            "bundle_id": .string("com.example.app"),
            "terminate_running": .bool(true),
        ])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("--terminate-running-process"))
    }

    @Test("launch_app uses explicit UDID when provided")
    func launchAppExplicitUDID() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "launch", stdout: "com.example.app: 1")

        _ = try await server.handleLaunchApp([
            "bundle_id": .string("com.example.app"),
            "udid": .string("EXPLICIT-UDID"),
        ])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("EXPLICIT-UDID"))
    }

    // MARK: - terminate_app

    @Test("terminate_app sends correct command")
    func terminateApp() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "terminate", stdout: "")

        let result = try await server.handleTerminateApp([
            "bundle_id": .string("com.example.app"),
        ])
        let text = result.first?.text ?? ""
        #expect(text.contains("terminated"))

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("terminate"))
        #expect(args.contains("com.example.app"))
    }

    @Test("terminate_app requires bundle_id")
    func terminateAppMissingBundleID() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleTerminateApp([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("bundle_id"))
        }
    }
}
