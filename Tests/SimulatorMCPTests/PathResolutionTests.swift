import Testing
import Foundation
import MCP
@testable import SimulatorMCP

/// Tests for output path resolution logic used by screenshot and recording tools.
@Suite("Path Resolution Tests")
struct PathResolutionTests {

    static func makeServer(outputDir: String = "/tmp/test-output") -> SimulatorMCPServer {
        let executor = MockCommandExecutor()
        let simctl = SimctlClient(executor: executor)
        let runner = XCTestRunnerClient(simctl: simctl)
        return SimulatorMCPServer(simctl: simctl, runner: runner, defaultOutputDir: outputDir)
    }

    @Test("resolveOutputPath returns default dir when path is nil")
    func resolveNilPath() async throws {
        let server = Self.makeServer(outputDir: "/tmp/downloads")
        let result = await server.resolveOutputPath(nil)
        #expect(result == "/tmp/downloads")
    }

    @Test("resolveOutputPath returns absolute path unchanged")
    func resolveAbsolutePath() async throws {
        let server = Self.makeServer()
        let result = await server.resolveOutputPath("/absolute/path/screenshot.png")
        #expect(result == "/absolute/path/screenshot.png")
    }

    @Test("resolveOutputPath joins relative path with default dir")
    func resolveRelativePath() async throws {
        let server = Self.makeServer(outputDir: "/tmp/downloads")
        let result = await server.resolveOutputPath("screenshot.png")
        #expect(result == "/tmp/downloads/screenshot.png")
    }

    @Test("resolveOutputPath expands tilde")
    func resolveTildePath() async throws {
        let server = Self.makeServer()
        let result = await server.resolveOutputPath("~/Desktop/screenshot.png")
        #expect(!result.contains("~"))
        #expect(result.hasSuffix("Desktop/screenshot.png"))
    }

    @Test("resolveOutputPath handles subdirectory in relative path")
    func resolveRelativeSubdir() async throws {
        let server = Self.makeServer(outputDir: "/tmp/out")
        let result = await server.resolveOutputPath("captures/shot.png")
        #expect(result == "/tmp/out/captures/shot.png")
    }
}
