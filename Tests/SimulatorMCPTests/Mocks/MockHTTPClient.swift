import Foundation
@testable import SimulatorMCP

/// Mock implementation of `HTTPClientProtocol` for unit tests.
final class MockHTTPClient: HTTPClientProtocol, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private let handler: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    /// All recorded requests (thread-safe).
    var requests: [URLRequest] {
        lock.withLock { _requests }
    }

    init(handler: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse)) {
        self.handler = handler
    }

    /// Create a mock that always returns the given JSON-encodable value.
    static func json<T: Encodable>(_ value: T, statusCode: Int = 200) -> MockHTTPClient {
        MockHTTPClient { request in
            let data = try JSONEncoder().encode(value)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (data, response)
        }
    }

    /// Create a mock that always returns the given raw JSON string.
    static func rawJSON(_ json: String, statusCode: Int = 200) -> MockHTTPClient {
        MockHTTPClient { request in
            let data = Data(json.utf8)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (data, response)
        }
    }

    /// Create a mock that always returns an HTTP error.
    static func error(statusCode: Int) -> MockHTTPClient {
        MockHTTPClient { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { _requests.append(request) }
        return try await handler(request)
    }
}
