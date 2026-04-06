import Foundation

/// Represents an iOS Simulator device parsed from `simctl list devices`
struct SimDevice: Sendable {
    let name: String
    let udid: String
    let state: String
    let runtime: String

    var isBooted: Bool { state == "Booted" }
}

/// Represents a simulator runtime parsed from `simctl list runtimes`
struct SimRuntime: Sendable {
    let name: String
    let identifier: String
    let version: String
    let isAvailable: Bool
}
