import Testing
import Foundation
import MCP
@testable import SimulatorMCP

@Suite("Value Helper Tests")
struct ValueHelpersTests {

    // MARK: - Argument Extraction

    @Test("string extracts string value")
    func stringExtraction() {
        let args: [String: Value] = ["name": .string("hello")]
        #expect(args.string("name") == "hello")
    }

    @Test("string returns nil for missing key")
    func stringMissing() {
        let args: [String: Value] = [:]
        #expect(args.string("name") == nil)
    }

    @Test("string returns nil for non-string value")
    func stringWrongType() {
        let args: [String: Value] = ["name": .number(42)]
        #expect(args.string("name") == nil)
    }

    @Test("double extracts number value")
    func doubleExtraction() {
        let args: [String: Value] = ["x": .number(3.14)]
        #expect(args.double("x") == 3.14)
    }

    @Test("int extracts integer from number")
    func intExtraction() {
        let args: [String: Value] = ["count": .number(5)]
        #expect(args.int("count") == 5)
    }

    @Test("bool extracts boolean value")
    func boolExtraction() {
        let args: [String: Value] = ["flag": .bool(true)]
        #expect(args.bool("flag") == true)
    }

    @Test("stringArray extracts array of strings")
    func stringArrayExtraction() {
        let args: [String: Value] = [
            "paths": .array([.string("/a"), .string("/b")])
        ]
        #expect(args.stringArray("paths") == ["/a", "/b"])
    }

    @Test("stringArray returns nil for non-array")
    func stringArrayWrongType() {
        let args: [String: Value] = ["paths": .string("not an array")]
        #expect(args.stringArray("paths") == nil)
    }
}
