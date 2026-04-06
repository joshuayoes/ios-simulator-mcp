import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Tests for simulator lifecycle tool handlers.
/// Uses MockCommandExecutor to verify correct simctl commands without a real simulator.
@Suite("Simulator Tool Handler Tests")
struct SimulatorToolHandlerTests {

    /// Helper: create a server with a mock executor and pre-stubbed device list.
    static func makeServer(executor: MockCommandExecutor) -> (SimulatorMCPServer, MockCommandExecutor) {
        let simctl = SimctlClient(executor: executor)
        let runner = XCTestRunnerClient(simctl: simctl)
        let server = SimulatorMCPServer(simctl: simctl, runner: runner)
        return (server, executor)
    }

    static func makeServerWithBootedDevice() -> (SimulatorMCPServer, MockCommandExecutor) {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: """
        {"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-2":[
            {"udid":"AAAA-BBBB","name":"iPhone 16","state":"Booted"},
            {"udid":"CCCC-DDDD","name":"iPad Air","state":"Shutdown"}
        ]}}
        """)
        return makeServer(executor: executor)
    }

    // MARK: - get_booted_sim_id

    @Test("get_booted_sim_id returns booted device info")
    func getBootedSimId() async throws {
        let (server, _) = Self.makeServerWithBootedDevice()
        let result = try await server.handleGetBootedSimId([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("iPhone 16"))
        #expect(text.contains("AAAA-BBBB"))
    }

    @Test("get_booted_sim_id returns error when no device booted")
    func getBootedSimIdNoDevice() async throws {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: """
        {"devices":{"r":[{"udid":"X","name":"Phone","state":"Shutdown"}]}}
        """)
        let (server, _) = Self.makeServer(executor: executor)

        do {
            _ = try await server.handleGetBootedSimId([:])
            Issue.record("Expected error to be thrown")
        } catch {
            #expect("\(error)".contains("No booted simulator"))
        }
    }

    // MARK: - list_simulators

    @Test("list_simulators returns all devices")
    func listSimulators() async throws {
        let (server, _) = Self.makeServerWithBootedDevice()
        let result = try await server.handleListSimulators([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("iPhone 16"))
        #expect(text.contains("iPad Air"))
        #expect(text.contains("[Booted]"))
    }

    @Test("list_simulators filters by state")
    func listSimulatorsFiltered() async throws {
        let (server, _) = Self.makeServerWithBootedDevice()
        let result = try await server.handleListSimulators(["state": .string("Booted")])
        let text = result.first?.text ?? ""
        #expect(text.contains("iPhone 16"))
        #expect(!text.contains("iPad Air"))
    }

    @Test("list_simulators returns empty message when no devices match")
    func listSimulatorsEmpty() async throws {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: #"{"devices":{}}"#)
        let (server, _) = Self.makeServer(executor: executor)
        let result = try await server.handleListSimulators([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("No simulators"))
    }

    // MARK: - boot_simulator

    @Test("boot_simulator sends boot command with UDID")
    func bootSimulator() async throws {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "boot", stdout: "")
        let (server, _) = Self.makeServer(executor: executor)

        let result = try await server.handleBootSimulator(["udid": .string("TEST-UDID")])
        let text = result.first?.text ?? ""
        #expect(text.contains("booted"))

        let args = executor.invocations.first?.arguments ?? []
        #expect(args.contains("boot"))
        #expect(args.contains("TEST-UDID"))
    }

    @Test("boot_simulator requires UDID")
    func bootSimulatorMissingUDID() async throws {
        let executor = MockCommandExecutor()
        let (server, _) = Self.makeServer(executor: executor)

        do {
            _ = try await server.handleBootSimulator([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("UDID"))
        }
    }

    // MARK: - shutdown_simulator

    @Test("shutdown_simulator uses provided UDID")
    func shutdownSimulatorExplicitUDID() async throws {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "shutdown", stdout: "")
        let (server, _) = Self.makeServer(executor: executor)

        _ = try await server.handleShutdownSimulator(["udid": .string("MY-UDID")])

        let args = executor.invocations.first?.arguments ?? []
        #expect(args.contains("shutdown"))
        #expect(args.contains("MY-UDID"))
    }

    @Test("shutdown_simulator falls back to booted device")
    func shutdownSimulatorFallback() async throws {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: """
        {"devices":{"r":[{"udid":"BOOTED-ID","name":"Phone","state":"Booted"}]}}
        """)
        executor.stubSuccess(matching: "shutdown", stdout: "")
        let (server, _) = Self.makeServer(executor: executor)

        _ = try await server.handleShutdownSimulator([:])

        let shutdownArgs = executor.invocations.last?.arguments ?? []
        #expect(shutdownArgs.contains("BOOTED-ID"))
    }

    // MARK: - open_simulator

    @Test("open_simulator calls open -a Simulator.app")
    func openSimulator() async throws {
        let executor = MockCommandExecutor()
        executor.stub(
            matcher: { path, _ in path.contains("open") },
            result: .success(CommandResult(stdout: "", stderr: "", exitCode: 0))
        )
        let (server, _) = Self.makeServer(executor: executor)

        let result = try await server.handleOpenSimulator([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("opened"))

        let invocation = executor.invocations.first
        #expect(invocation?.arguments.contains("Simulator.app") == true)
    }
}
