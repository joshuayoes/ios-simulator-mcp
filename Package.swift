// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SimulatorMCP",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/modelcontextprotocol/swift-sdk.git", from: "0.7.1"),
    ],
    targets: [
        .executableTarget(
            name: "SimulatorMCP",
            dependencies: [
                .product(name: "MCP", package: "swift-sdk"),
            ]
        ),
    ]
)
