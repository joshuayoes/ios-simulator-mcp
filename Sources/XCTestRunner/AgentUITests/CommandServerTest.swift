import XCTest
import Network

/// Persistent XCUITest that runs an HTTP command server inside the simulator.
/// This test stays alive and accepts commands from the MCP server process
/// over a local TCP connection. This eliminates the need for Facebook's idb.
///
/// Commands are sent as JSON POST requests to http://127.0.0.1:<port>/command
/// The port is logged via NSLog("SIMULATOR_MCP_RUNNER_PORT=<port>") for discovery.
final class CommandServerTest: XCTestCase {

    /// The test runs for up to 24 hours — the MCP server controls its lifecycle.
    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    /// Main entry point. Starts the HTTP server and blocks until cancelled.
    func testCommand() throws {
        let server = CommandServer()
        server.start()

        // Block until the test is cancelled or times out
        let expectation = XCTestExpectation(description: "Server running")
        expectation.isInverted = true // Never fulfilled — keeps test alive
        wait(for: [expectation], timeout: 86400) // 24 hours

        server.stop()
    }
}

/// Lightweight HTTP server using Network.framework that listens for JSON commands.
/// Runs inside the XCUITest process, giving it full access to XCUIApplication
/// and the accessibility tree without requiring external tools like idb.
class CommandServer {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "simulator-mcp-runner")
    private let handler = CommandHandler()

    func start() {
        do {
            let parameters = NWParameters.tcp
            // Let the OS assign an available port
            listener = try NWListener(using: parameters, on: .any)
        } catch {
            NSLog("SIMULATOR_MCP_RUNNER_ERROR=Failed to create listener: \(error)")
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let port = self?.listener?.port?.rawValue {
                    // The MCP server process watches for this log line to discover the port
                    NSLog("SIMULATOR_MCP_RUNNER_PORT=\(port)")
                }
            case .failed(let error):
                NSLog("SIMULATOR_MCP_RUNNER_ERROR=Listener failed: \(error)")
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveHTTPRequest(on: connection)
    }

    private func receiveHTTPRequest(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self, let data = data, !data.isEmpty else {
                connection.cancel()
                return
            }

            // Parse HTTP request (simple: just extract the JSON body after headers)
            let request = String(data: data, encoding: .utf8) ?? ""
            let response: String

            if request.hasPrefix("POST") {
                // Extract JSON body after the double newline
                if let bodyRange = request.range(of: "\r\n\r\n") {
                    let body = String(request[bodyRange.upperBound...])
                    let result = self.handler.handleCommand(body)
                    response = self.httpResponse(200, body: result)
                } else {
                    response = self.httpResponse(400, body: #"{"error":"No body in request"}"#)
                }
            } else if request.hasPrefix("GET /health") {
                response = self.httpResponse(200, body: #"{"status":"ok"}"#)
            } else {
                response = self.httpResponse(404, body: #"{"error":"Not found"}"#)
            }

            let responseData = Data(response.utf8)
            connection.send(content: responseData, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func httpResponse(_ status: Int, body: String) -> String {
        let statusText = status == 200 ? "OK" : (status == 400 ? "Bad Request" : "Not Found")
        return "HTTP/1.1 \(status) \(statusText)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    }
}
