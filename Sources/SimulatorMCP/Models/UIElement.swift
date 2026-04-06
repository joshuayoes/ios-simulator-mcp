import Foundation

/// Represents an accessibility element from the UI hierarchy
struct UIElement: Codable, Sendable {
    let type: String?
    let label: String?
    let value: String?
    let identifier: String?
    let frame: ElementFrame?
    let traits: [String]?
    let children: [UIElement]?

    struct ElementFrame: Codable, Sendable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
}
