import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Tests for device control tool handlers.
@Suite("Device Tool Handler Tests")
struct DeviceToolHandlerTests {

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

    // MARK: - set_appearance

    @Test("set_appearance sends correct command")
    func setAppearance() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "appearance", stdout: "")

        let result = try await server.handleSetAppearance(["appearance": .string("dark")])
        let text = result.first?.text ?? ""
        #expect(text.contains("dark"))

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("appearance"))
        #expect(args.contains("dark"))
    }

    @Test("set_appearance requires appearance parameter")
    func setAppearanceMissing() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleSetAppearance([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("appearance"))
        }
    }

    // MARK: - get_appearance

    @Test("get_appearance returns current mode")
    func getAppearance() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "appearance", stdout: "dark")

        let result = try await server.handleGetAppearance([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("dark"))
    }

    // MARK: - set_location

    @Test("set_location sends coordinates")
    func setLocation() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "location", stdout: "")

        let result = try await server.handleSetLocation([
            "latitude": .number(37.7749),
            "longitude": .number(-122.4194),
        ])
        let text = result.first?.text ?? ""
        #expect(text.contains("37.7749"))

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("location"))
        #expect(args.contains("set"))
    }

    @Test("set_location requires both coordinates")
    func setLocationMissingCoords() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleSetLocation(["latitude": .number(37.0)])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("latitude") || "\(error)".contains("longitude"))
        }
    }

    // MARK: - clear_location

    @Test("clear_location sends clear command")
    func clearLocation() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "location", stdout: "")

        _ = try await server.handleClearLocation([:])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("location"))
        #expect(args.contains("clear"))
    }

    // MARK: - set_privacy

    @Test("set_privacy sends correct command")
    func setPrivacy() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "privacy", stdout: "")

        let result = try await server.handleSetPrivacy([
            "action": .string("grant"),
            "service": .string("camera"),
            "bundle_id": .string("com.example.app"),
        ])
        let text = result.first?.text ?? ""
        #expect(text.contains("grant"))
        #expect(text.contains("camera"))

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("privacy"))
        #expect(args.contains("grant"))
        #expect(args.contains("camera"))
        #expect(args.contains("com.example.app"))
    }

    @Test("set_privacy requires all parameters")
    func setPrivacyMissingParams() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleSetPrivacy(["action": .string("grant")])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("required"))
        }
    }

    // MARK: - open_url

    @Test("open_url sends openurl command with -- separator")
    func openURL() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "openurl", stdout: "")

        _ = try await server.handleOpenURL(["url": .string("https://example.com")])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("openurl"))
        let dashIdx = args.firstIndex(of: "--")
        let urlIdx = args.firstIndex(of: "https://example.com")
        #expect(dashIdx != nil && urlIdx != nil)
        #expect(dashIdx! < urlIdx!)
    }

    @Test("open_url requires url parameter")
    func openURLMissing() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleOpenURL([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("url"))
        }
    }

    // MARK: - set_status_bar

    @Test("set_status_bar sends override with time")
    func setStatusBarTime() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "status_bar", stdout: "")

        _ = try await server.handleSetStatusBar(["time": .string("9:41")])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("status_bar"))
        #expect(args.contains("override"))
        #expect(args.contains("--time"))
        #expect(args.contains("9:41"))
    }

    @Test("set_status_bar with no overrides returns message")
    func setStatusBarEmpty() async throws {
        let (server, _) = Self.makeServer()
        let result = try await server.handleSetStatusBar([:])
        let text = result.first?.text ?? ""
        #expect(text.contains("No status bar overrides"))
    }

    // MARK: - clear_status_bar

    @Test("clear_status_bar sends clear command")
    func clearStatusBar() async throws {
        let (server, executor) = Self.makeServer()
        executor.stubSuccess(matching: "status_bar", stdout: "")

        _ = try await server.handleClearStatusBar([:])

        let args = executor.invocations.last?.arguments ?? []
        #expect(args.contains("clear"))
    }

    // MARK: - add_media

    @Test("add_media requires non-empty paths")
    func addMediaEmptyPaths() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleAddMedia(["paths": .array([])])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("paths"))
        }
    }

    @Test("add_media verifies files exist")
    func addMediaFileNotFound() async throws {
        let (server, _) = Self.makeServer()
        do {
            _ = try await server.handleAddMedia(["paths": .array([.string("/nonexistent/photo.jpg")])])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("not found"))
        }
    }
}
