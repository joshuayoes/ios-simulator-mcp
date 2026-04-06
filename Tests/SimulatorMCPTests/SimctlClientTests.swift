import Testing
import Foundation
@testable import SimulatorMCP

@Suite("SimctlClient Tests")
struct SimctlClientTests {

    // MARK: - Device List Parsing (static, no mock needed)

    @Test("parseDeviceList extracts devices from JSON")
    func parseDeviceList() throws {
        let json = """
        {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
                    {"udid": "AAA-BBB", "name": "iPhone 16", "state": "Booted"},
                    {"udid": "CCC-DDD", "name": "iPhone 16 Pro", "state": "Shutdown"}
                ],
                "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
                    {"udid": "EEE-FFF", "name": "iPad Air", "state": "Shutdown"}
                ]
            }
        }
        """

        let devices = try SimctlClient.parseDeviceList(json)

        #expect(devices.count == 3)
        #expect(devices.contains(where: { $0.name == "iPhone 16" && $0.isBooted }))
        #expect(devices.contains(where: { $0.name == "iPhone 16 Pro" && !$0.isBooted }))
        #expect(devices.contains(where: { $0.name == "iPad Air" }))
    }

    @Test("parseDeviceList strips runtime prefix")
    func parseDeviceListRuntimeName() throws {
        let json = """
        {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
                    {"udid": "AAA", "name": "iPhone", "state": "Booted"}
                ]
            }
        }
        """

        let devices = try SimctlClient.parseDeviceList(json)
        #expect(devices.first?.runtime.contains("iOS") == true)
        #expect(!devices.first!.runtime.contains("com.apple"))
    }

    @Test("parseDeviceList handles empty device list")
    func parseEmptyDeviceList() throws {
        let json = #"{"devices": {}}"#
        let devices = try SimctlClient.parseDeviceList(json)
        #expect(devices.isEmpty)
    }

    @Test("parseDeviceList throws on invalid JSON")
    func parseInvalidJSON() {
        #expect(throws: SimctlError.self) {
            try SimctlClient.parseDeviceList("not json")
        }
    }

    @Test("parseDeviceList throws on unexpected format")
    func parseUnexpectedFormat() {
        #expect(throws: SimctlError.self) {
            try SimctlClient.parseDeviceList(#"{"devices": "not a dict"}"#)
        }
    }

    @Test("parseDeviceList skips devices with missing fields")
    func parseDevicesWithMissingFields() throws {
        let json = """
        {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                    {"udid": "AAA", "name": "Good Device", "state": "Booted"},
                    {"udid": "BBB", "state": "Shutdown"},
                    {"name": "No UDID", "state": "Shutdown"}
                ]
            }
        }
        """
        let devices = try SimctlClient.parseDeviceList(json)
        #expect(devices.count == 1)
        #expect(devices.first?.name == "Good Device")
    }

    // MARK: - PID Extraction (static)

    @Test("extractPID finds PID in launch output", arguments: [
        ("com.example.app: 12345", "12345"),
        ("com.apple.mobilesafari: 99999", "99999"),
    ])
    func extractPID(output: String, expectedPID: String) {
        #expect(SimctlClient.extractPID(from: output) == expectedPID)
    }

    @Test("extractPID returns nil for output without PID")
    func extractPIDMissing() {
        #expect(SimctlClient.extractPID(from: "App launched") == nil)
        #expect(SimctlClient.extractPID(from: "") == nil)
    }

    // MARK: - Device Discovery (with mock executor)

    @Test("listDevices calls simctl with correct arguments")
    func listDevicesCommand() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "list", stdout: #"{"devices": {}}"#)

        let client = SimctlClient(executor: mock)
        _ = try await client.listDevices()

        let invocation = mock.invocations.first
        #expect(invocation?.arguments.contains("simctl") == true)
        #expect(invocation?.arguments.contains("list") == true)
        #expect(invocation?.arguments.contains("devices") == true)
        #expect(invocation?.arguments.contains("--json") == true)
    }

    @Test("getBootedDevice returns booted device")
    func getBootedDevice() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "list", stdout: """
        {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                    {"udid": "BOOTED-ID", "name": "iPhone 16", "state": "Booted"},
                    {"udid": "OFF-ID", "name": "iPad", "state": "Shutdown"}
                ]
            }
        }
        """)

        let client = SimctlClient(executor: mock)
        let device = try await client.getBootedDevice()
        #expect(device.udid == "BOOTED-ID")
        #expect(device.name == "iPhone 16")
    }

    @Test("getBootedDevice throws when no device is booted")
    func getBootedDeviceNoneBooted() async {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "list", stdout: """
        {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                    {"udid": "OFF-ID", "name": "iPad", "state": "Shutdown"}
                ]
            }
        }
        """)

        let client = SimctlClient(executor: mock)
        await #expect(throws: SimctlError.self) {
            try await client.getBootedDevice()
        }
    }

    // MARK: - resolveUDID

    @Test("resolveUDID returns provided UDID when given")
    func resolveUDIDExplicit() async throws {
        let mock = MockCommandExecutor()
        let client = SimctlClient(executor: mock)
        let udid = try await client.resolveUDID("EXPLICIT-ID")
        #expect(udid == "EXPLICIT-ID")
        #expect(mock.invocations.isEmpty) // Should not call simctl
    }

    @Test("resolveUDID falls back to booted device when nil")
    func resolveUDIDFallback() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "list", stdout: """
        {"devices": {"r": [{"udid": "BOOTED", "name": "Phone", "state": "Booted"}]}}
        """)

        let client = SimctlClient(executor: mock)
        let udid = try await client.resolveUDID(nil)
        #expect(udid == "BOOTED")
    }

    // MARK: - Simulator Lifecycle Commands

    @Test("bootDevice sends correct command")
    func bootDevice() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "boot", stdout: "")
        let client = SimctlClient(executor: mock)

        try await client.bootDevice("TEST-UDID")

        let args = mock.invocations.first?.arguments ?? []
        #expect(args.contains("boot"))
        #expect(args.contains("TEST-UDID"))
    }

    @Test("bootDevice throws on failure")
    func bootDeviceFailure() async {
        let mock = MockCommandExecutor()
        mock.stubFailure(matching: "boot", stderr: "Unable to boot device in current state")
        let client = SimctlClient(executor: mock)

        await #expect(throws: SimctlError.self) {
            try await client.bootDevice("BAD-ID")
        }
    }

    @Test("launchApp includes terminate flag when requested")
    func launchAppWithTerminate() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "launch", stdout: "com.example: 42")
        let client = SimctlClient(executor: mock)

        let pid = try await client.launchApp(udid: "UID", bundleID: "com.example", terminateExisting: true)

        let args = mock.invocations.first?.arguments ?? []
        #expect(args.contains("--terminate-running-process"))
        #expect(args.contains("com.example"))
        #expect(pid == "42")
    }

    @Test("screenshot uses -- separator before output path")
    func screenshotArgSeparator() async throws {
        let mock = MockCommandExecutor()
        mock.stubSuccess(matching: "screenshot", stdout: "", stderr: "Wrote screenshot to /tmp/test.png")
        let client = SimctlClient(executor: mock)

        try await client.screenshot(udid: "UID", outputPath: "/tmp/test.png")

        let args = mock.invocations.first?.arguments ?? []
        let dashDashIndex = args.firstIndex(of: "--")
        let pathIndex = args.firstIndex(of: "/tmp/test.png")
        #expect(dashDashIndex != nil)
        #expect(pathIndex != nil)
        #expect(dashDashIndex! < pathIndex!) // -- comes before user-provided path
    }
}

// MARK: - SimDevice Model Tests

@Suite("SimDevice Tests")
struct SimDeviceTests {
    @Test("isBooted returns true for Booted state")
    func isBooted() {
        let device = SimDevice(name: "iPhone", udid: "123", state: "Booted", runtime: "iOS 18")
        #expect(device.isBooted)
    }

    @Test("isBooted returns false for Shutdown state")
    func isNotBooted() {
        let device = SimDevice(name: "iPhone", udid: "123", state: "Shutdown", runtime: "iOS 18")
        #expect(!device.isBooted)
    }
}
