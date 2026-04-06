import Foundation

/// Protocol for executing shell commands. Enables mocking in tests.
/// Production code uses `ProcessCommandExecutor`; tests use `MockCommandExecutor`.
protocol CommandExecuting: Sendable {
    func execute(executablePath: String, arguments: [String]) async throws -> CommandResult
}

/// Result of a command execution.
struct CommandResult: Sendable, Equatable {
    let stdout: String
    let stderr: String
    let exitCode: Int32

    var succeeded: Bool { exitCode == 0 }
}

/// Production implementation that runs real `Process` instances.
struct ProcessCommandExecutor: CommandExecuting {
    func execute(executablePath: String, arguments: [String]) async throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

        let stdout = String(data: stdoutData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let stderr = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        return CommandResult(stdout: stdout, stderr: stderr, exitCode: process.terminationStatus)
    }
}

/// Protocol for making HTTP requests. Enables mocking in tests.
protocol HTTPClientProtocol: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

/// Production implementation using URLSession.
struct URLSessionHTTPClient: HTTPClientProtocol {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}
