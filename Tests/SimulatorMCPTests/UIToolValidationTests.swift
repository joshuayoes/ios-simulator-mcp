import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Tests for UI tool input validation.
/// These test the handler-level validation logic, NOT the XCTest runner communication.
/// The runner calls will fail in tests (no real runner), so we only test validation errors.
@Suite("UI Tool Validation Tests")
struct UIToolValidationTests {

    static func makeServer() -> SimulatorMCPServer {
        let executor = MockCommandExecutor()
        executor.stubSuccess(matching: "list", stdout: """
        {"devices":{"r":[{"udid":"SIM-ID","name":"iPhone 16","state":"Booted"}]}}
        """)
        let simctl = SimctlClient(executor: executor)
        let runner = XCTestRunnerClient(simctl: simctl)
        return SimulatorMCPServer(simctl: simctl, runner: runner)
    }

    // MARK: - ui_tap validation

    @Test("ui_tap requires x coordinate")
    func tapMissingX() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUITap(["y": .number(100)])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("x and y"))
        }
    }

    @Test("ui_tap requires y coordinate")
    func tapMissingY() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUITap(["x": .number(100)])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("x and y"))
        }
    }

    // MARK: - ui_double_tap validation

    @Test("ui_double_tap requires coordinates")
    func doubleTapMissingCoords() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUIDoubleTap([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("x and y"))
        }
    }

    // MARK: - ui_long_press validation

    @Test("ui_long_press requires coordinates")
    func longPressMissingCoords() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUILongPress([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("x and y"))
        }
    }

    // MARK: - ui_type validation

    @Test("ui_type requires text")
    func typeMissingText() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUIType([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("text"))
        }
    }

    @Test("ui_type rejects text over 500 characters")
    func typeTextTooLong() async throws {
        let server = Self.makeServer()
        let longText = String(repeating: "a", count: 501)
        do {
            _ = try await server.handleUIType(["text": .string(longText)])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("500"))
        }
    }

    @Test("ui_type accepts text at exactly 500 characters")
    func typeTextMaxLength() async throws {
        // This will fail at the runner level (no real runner), but should NOT fail validation
        let server = Self.makeServer()
        let text = String(repeating: "a", count: 500)
        do {
            _ = try await server.handleUIType(["text": .string(text)])
            // If it gets past validation, it will fail at runner communication — that's OK
        } catch {
            // Should NOT be a validation error about length
            #expect(!"\(error)".contains("500"))
        }
    }

    // MARK: - ui_swipe validation

    @Test("ui_swipe requires all four coordinates")
    func swipeMissingCoords() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUISwipe(["x_start": .number(0), "y_start": .number(0)])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("x_start"))
        }
    }

    // MARK: - ui_find_element validation

    @Test("ui_find_element requires identifier or label")
    func findElementMissingParams() async throws {
        let server = Self.makeServer()
        do {
            _ = try await server.handleUIFindElement([:])
            Issue.record("Expected error")
        } catch {
            #expect("\(error)".contains("identifier") || "\(error)".contains("label"))
        }
    }
}
