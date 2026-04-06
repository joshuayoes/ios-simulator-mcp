import Foundation
@testable import SimulatorMCP

/// Mock implementation of `CommandExecuting` for unit tests.
/// Allows stubbing command outputs and recording invocations.
final class MockCommandExecutor: CommandExecuting, @unchecked Sendable {
    private let lock = NSLock()
    private var _invocations: [(executablePath: String, arguments: [String])] = []
    private var _stubs: [(matcher: (String, [String]) -> Bool, result: Result<CommandResult, Error>)] = []

    /// All recorded invocations (thread-safe).
    var invocations: [(executablePath: String, arguments: [String])] {
        lock.withLock { _invocations }
    }

    /// Stub a successful result for commands whose arguments contain the given keyword.
    func stubSuccess(matching keyword: String, stdout: String, stderr: String = "") {
        lock.withLock {
            _stubs.append((
                matcher: { _, args in args.contains(where: { $0.contains(keyword) }) },
                result: .success(CommandResult(stdout: stdout, stderr: stderr, exitCode: 0))
            ))
        }
    }

    /// Stub a failure result for commands whose arguments contain the given keyword.
    func stubFailure(matching keyword: String, stderr: String, exitCode: Int32 = 1) {
        lock.withLock {
            _stubs.append((
                matcher: { _, args in args.contains(where: { $0.contains(keyword) }) },
                result: .success(CommandResult(stdout: "", stderr: stderr, exitCode: exitCode))
            ))
        }
    }

    /// Stub a throwing error for commands whose arguments contain the given keyword.
    func stubError(matching keyword: String, error: Error) {
        lock.withLock {
            _stubs.append((
                matcher: { _, args in args.contains(where: { $0.contains(keyword) }) },
                result: .failure(error)
            ))
        }
    }

    /// Stub a result with a custom matcher.
    func stub(matcher: @escaping (String, [String]) -> Bool, result: Result<CommandResult, Error>) {
        lock.withLock {
            _stubs.append((matcher: matcher, result: result))
        }
    }

    func execute(executablePath: String, arguments: [String]) async throws -> CommandResult {
        lock.withLock { _invocations.append((executablePath, arguments)) }

        let matchedResult: Result<CommandResult, Error>? = lock.withLock {
            for stub in _stubs {
                if stub.matcher(executablePath, arguments) {
                    return stub.result
                }
            }
            return nil
        }

        switch matchedResult {
        case .success(let result):
            return result
        case .failure(let error):
            throw error
        case nil:
            fatalError("MockCommandExecutor: No stub matched for \(executablePath) \(arguments)")
        }
    }
}
