import Testing
import Foundation
@testable import SimulatorMCP

@Suite("Tool Registry Tests")
struct ToolRegistryTests {

    @Test("all tools have unique names")
    func uniqueToolNames() {
        let names = ToolRegistry.allTools.map { $0.name }
        let uniqueNames = Set(names)
        #expect(names.count == uniqueNames.count, "Duplicate tool names found: \(names.count) total vs \(uniqueNames.count) unique")
    }

    @Test("tool names use snake_case")
    func snakeCaseNames() {
        for entry in ToolRegistry.allTools {
            #expect(
                entry.name.range(of: #"^[a-z][a-z0-9_]*$"#, options: .regularExpression) != nil,
                "Tool name '\(entry.name)' is not snake_case"
            )
        }
    }

    @Test("all tools have non-empty descriptions")
    func nonEmptyDescriptions() {
        for entry in ToolRegistry.allTools {
            let description = entry.tool.description ?? ""
            #expect(!description.isEmpty, "Tool '\(entry.name)' has empty description")
        }
    }

    @Test("tool entry name matches tool name")
    func entryNameMatchesToolName() {
        for entry in ToolRegistry.allTools {
            #expect(entry.name == entry.tool.name, "Entry name '\(entry.name)' doesn't match tool name '\(entry.tool.name)'")
        }
    }

    @Test("tool filtering excludes specified tools")
    func toolFiltering() {
        let filtered: Set<String> = ["ui_tap", "ui_swipe", "record_video"]
        let available = ToolRegistry.allTools.filter { !filtered.contains($0.name) }

        #expect(!available.contains(where: { $0.name == "ui_tap" }))
        #expect(!available.contains(where: { $0.name == "ui_swipe" }))
        #expect(!available.contains(where: { $0.name == "record_video" }))
        #expect(available.contains(where: { $0.name == "screenshot" }))
        #expect(available.contains(where: { $0.name == "ui_type" }))
    }

    @Test("total tool count is correct")
    func toolCount() {
        // 5 simulator + 9 UI + 4 capture + 3 app + 10 device = 31
        #expect(ToolRegistry.allTools.count == 31)
    }
}
