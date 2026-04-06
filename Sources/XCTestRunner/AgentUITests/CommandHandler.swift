import XCTest
import Foundation

/// Handles JSON commands received by the CommandServer.
/// Each command maps to XCUITest operations — taps, types, swipes,
/// and accessibility tree queries — all without needing idb.
class CommandHandler {

    // Lazy-initialize the app proxy. The runner doesn't launch an app itself;
    // it attaches to whatever is running on the simulator.
    private lazy var springboard: XCUIApplication = {
        XCUIApplication(bundleIdentifier: "com.apple.springboard")
    }()

    /// Parse and execute a JSON command string. Returns a JSON response string.
    func handleCommand(_ jsonString: String) -> String {
        guard let data = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let command = json["command"] as? String
        else {
            return errorResponse("Invalid JSON or missing 'command' field")
        }

        let params = json["params"] as? [String: Any] ?? [:]

        do {
            let result = try executeCommand(command, params: params)
            return successResponse(result)
        } catch {
            return errorResponse("\(error)")
        }
    }

    // MARK: - Command Dispatch

    private func executeCommand(_ command: String, params: [String: Any]) throws -> Any {
        switch command {
        case "snapshot":
            return try snapshot(params)
        case "describe_point":
            return try describePoint(params)
        case "tap":
            try tap(params)
            return ["status": "ok"]
        case "double_tap":
            try doubleTap(params)
            return ["status": "ok"]
        case "long_press":
            try longPress(params)
            return ["status": "ok"]
        case "type":
            try typeText(params)
            return ["status": "ok"]
        case "swipe":
            try swipe(params)
            return ["status": "ok"]
        case "press_button":
            try pressButton(params)
            return ["status": "ok"]
        case "find_element":
            return try findElement(params)
        case "health":
            return ["status": "ok"]
        default:
            throw RunnerError.unknownCommand(command)
        }
    }

    // MARK: - Accessibility Tree (Snapshot)

    /// Capture the full accessibility tree for the frontmost application.
    private func snapshot(_ params: [String: Any]) throws -> Any {
        let app = resolveApp(params)
        let interactiveOnly = params["interactive_only"] as? Bool ?? false
        let maxDepth = params["max_depth"] as? Int ?? 12

        let rootElement = app
        let tree = buildAccessibilityTree(element: rootElement, depth: 0, maxDepth: maxDepth, interactiveOnly: interactiveOnly)

        // Include screen dimensions from the app frame
        let frame = app.frame
        return [
            "frame": [
                "x": frame.origin.x,
                "y": frame.origin.y,
                "width": frame.size.width,
                "height": frame.size.height,
            ],
            "tree": tree,
        ] as [String: Any]
    }

    /// Build a recursive accessibility tree from an XCUIElement.
    private func buildAccessibilityTree(
        element: XCUIElement,
        depth: Int,
        maxDepth: Int,
        interactiveOnly: Bool
    ) -> [[String: Any]] {
        guard depth < maxDepth else { return [] }

        var nodes: [[String: Any]] = []
        let children = element.children(matching: .any)
        let count = children.count

        for i in 0..<count {
            let child = children.element(boundBy: i)
            guard child.exists else { continue }

            let elementType = child.elementType
            let isInteractive = Self.interactiveTypes.contains(elementType)

            // In interactive-only mode, skip non-interactive elements
            // but still recurse into them to find interactive descendants
            let hasContent = !child.label.isEmpty || !child.identifier.isEmpty
            let shouldInclude = !interactiveOnly || isInteractive || hasContent

            if shouldInclude {
                var node: [String: Any] = [
                    "type": Self.elementTypeName(elementType),
                    "frame": [
                        "x": child.frame.origin.x,
                        "y": child.frame.origin.y,
                        "width": child.frame.size.width,
                        "height": child.frame.size.height,
                    ],
                ]

                if !child.label.isEmpty {
                    node["label"] = child.label
                }
                if !child.identifier.isEmpty {
                    node["identifier"] = child.identifier
                }
                if let value = child.value {
                    let valueStr = "\(value)"
                    if !valueStr.isEmpty {
                        node["value"] = valueStr
                    }
                }
                node["enabled"] = child.isEnabled
                node["hittable"] = child.isHittable

                nodes.append(node)
            }

            // Recurse into children
            let childNodes = buildAccessibilityTree(
                element: child,
                depth: depth + 1,
                maxDepth: maxDepth,
                interactiveOnly: interactiveOnly
            )
            nodes.append(contentsOf: childNodes)
        }

        return nodes
    }

    // MARK: - Describe Point

    private func describePoint(_ params: [String: Any]) throws -> Any {
        guard let x = params["x"] as? Double, let y = params["y"] as? Double else {
            throw RunnerError.missingParam("x and y")
        }

        let app = resolveApp(params)
        let coordinate = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: x, dy: y))

        // Find the element at this coordinate by querying all elements
        // and checking which one's frame contains the point
        let point = CGPoint(x: x, y: y)
        let allElements = app.descendants(matching: .any).allElementsBoundByIndex

        for element in allElements.reversed() {
            guard element.exists && element.frame.contains(point) else { continue }
            return [
                "type": Self.elementTypeName(element.elementType),
                "label": element.label,
                "identifier": element.identifier,
                "value": element.value.map { "\($0)" } ?? "",
                "frame": [
                    "x": element.frame.origin.x,
                    "y": element.frame.origin.y,
                    "width": element.frame.size.width,
                    "height": element.frame.size.height,
                ],
                "enabled": element.isEnabled,
                "hittable": element.isHittable,
            ] as [String: Any]
        }

        throw RunnerError.noElementAtPoint(x, y)
    }

    // MARK: - UI Interactions

    private func tap(_ params: [String: Any]) throws {
        guard let x = params["x"] as? Double, let y = params["y"] as? Double else {
            throw RunnerError.missingParam("x and y")
        }

        let app = resolveApp(params)
        let duration = params["duration"] as? Double

        let coordinate = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: x, dy: y))

        if let duration = duration, duration > 0 {
            coordinate.press(forDuration: duration)
        } else {
            coordinate.tap()
        }
    }

    private func doubleTap(_ params: [String: Any]) throws {
        guard let x = params["x"] as? Double, let y = params["y"] as? Double else {
            throw RunnerError.missingParam("x and y")
        }

        let app = resolveApp(params)
        let coordinate = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: x, dy: y))
        coordinate.doubleTap()
    }

    private func longPress(_ params: [String: Any]) throws {
        guard let x = params["x"] as? Double, let y = params["y"] as? Double else {
            throw RunnerError.missingParam("x and y")
        }

        let duration = params["duration"] as? Double ?? 1.0
        let app = resolveApp(params)
        let coordinate = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: x, dy: y))
        coordinate.press(forDuration: duration)
    }

    private func typeText(_ params: [String: Any]) throws {
        guard let text = params["text"] as? String else {
            throw RunnerError.missingParam("text")
        }

        let app = resolveApp(params)

        // Find the focused element and type into it
        // XCUITest's typeText works on the focused element
        if let identifier = params["identifier"] as? String {
            // Type into a specific element by accessibility identifier
            let element = app.descendants(matching: .any)[identifier]
            guard element.exists else {
                throw RunnerError.elementNotFound(identifier)
            }
            element.tap()
            element.typeText(text)
        } else {
            // Type into whatever is currently focused
            // We need to find the element with keyboard focus
            let focusedElement = findFocusedElement(in: app)
            if let focused = focusedElement {
                focused.typeText(text)
            } else {
                // Fallback: type on the app itself
                app.typeText(text)
            }
        }
    }

    private func swipe(_ params: [String: Any]) throws {
        guard let xStart = params["x_start"] as? Double,
              let yStart = params["y_start"] as? Double,
              let xEnd = params["x_end"] as? Double,
              let yEnd = params["y_end"] as? Double
        else {
            throw RunnerError.missingParam("x_start, y_start, x_end, y_end")
        }

        let app = resolveApp(params)
        let duration = params["duration"] as? Double ?? 0.3

        let startCoord = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: xStart, dy: yStart))
        let endCoord = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: xEnd, dy: yEnd))

        startCoord.press(forDuration: 0.05, thenDragTo: endCoord, withVelocity: .default, thenHoldForDuration: duration)
    }

    private func pressButton(_ params: [String: Any]) throws {
        guard let button = params["button"] as? String else {
            throw RunnerError.missingParam("button")
        }

        switch button {
        case "home":
            XCUIDevice.shared.press(.home)
        default:
            throw RunnerError.unknownCommand("Unknown button: \(button)")
        }
    }

    // MARK: - Element Finding

    private func findElement(_ params: [String: Any]) throws -> Any {
        let app = resolveApp(params)

        if let identifier = params["identifier"] as? String {
            let element = app.descendants(matching: .any)[identifier]
            guard element.exists else {
                throw RunnerError.elementNotFound(identifier)
            }
            return elementToDict(element)
        }

        if let label = params["label"] as? String {
            let predicate = NSPredicate(format: "label == %@", label)
            let element = app.descendants(matching: .any).matching(predicate).firstMatch
            guard element.exists else {
                throw RunnerError.elementNotFound(label)
            }
            return elementToDict(element)
        }

        throw RunnerError.missingParam("identifier or label")
    }

    // MARK: - Helpers

    /// Resolve the target app. If a bundle_id is provided, use that;
    /// otherwise use springboard (the frontmost app).
    private func resolveApp(_ params: [String: Any]) -> XCUIApplication {
        if let bundleID = params["bundle_id"] as? String {
            return XCUIApplication(bundleIdentifier: bundleID)
        }
        return springboard
    }

    /// Find the element that currently has keyboard focus.
    private func findFocusedElement(in app: XCUIApplication) -> XCUIElement? {
        let textFields = app.textFields.allElementsBoundByIndex
        for field in textFields {
            if field.exists && field.hasKeyboardFocus {
                return field
            }
        }
        let textViews = app.textViews.allElementsBoundByIndex
        for view in textViews {
            if view.exists && view.hasKeyboardFocus {
                return view
            }
        }
        let secureTextFields = app.secureTextFields.allElementsBoundByIndex
        for field in secureTextFields {
            if field.exists && field.hasKeyboardFocus {
                return field
            }
        }
        return nil
    }

    private func elementToDict(_ element: XCUIElement) -> [String: Any] {
        var dict: [String: Any] = [
            "type": Self.elementTypeName(element.elementType),
            "frame": [
                "x": element.frame.origin.x,
                "y": element.frame.origin.y,
                "width": element.frame.size.width,
                "height": element.frame.size.height,
            ],
            "enabled": element.isEnabled,
            "hittable": element.isHittable,
        ]
        if !element.label.isEmpty { dict["label"] = element.label }
        if !element.identifier.isEmpty { dict["identifier"] = element.identifier }
        if let value = element.value { dict["value"] = "\(value)" }
        return dict
    }

    // MARK: - Element Type Mapping

    /// Interactive element types that are actionable by the user.
    static let interactiveTypes: Set<XCUIElement.ElementType> = [
        .button, .textField, .secureTextField, .textView,
        .switch, .slider, .stepper, .picker, .pickerWheel,
        .link, .cell, .tab, .segmentedControl, .toggle,
    ]

    /// Map XCUIElement.ElementType to human-readable strings.
    static func elementTypeName(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .any: return "Any"
        case .other: return "Other"
        case .application: return "Application"
        case .group: return "Group"
        case .window: return "Window"
        case .sheet: return "Sheet"
        case .drawer: return "Drawer"
        case .alert: return "Alert"
        case .dialog: return "Dialog"
        case .button: return "Button"
        case .radioButton: return "RadioButton"
        case .radioGroup: return "RadioGroup"
        case .checkBox: return "CheckBox"
        case .disclosureTriangle: return "DisclosureTriangle"
        case .popUpButton: return "PopUpButton"
        case .comboBox: return "ComboBox"
        case .menuButton: return "MenuButton"
        case .toolbarButton: return "ToolbarButton"
        case .popover: return "Popover"
        case .keyboard: return "Keyboard"
        case .key: return "Key"
        case .navigationBar: return "NavigationBar"
        case .tabBar: return "TabBar"
        case .tabGroup: return "TabGroup"
        case .toolbar: return "Toolbar"
        case .statusBar: return "StatusBar"
        case .table: return "Table"
        case .tableRow: return "TableRow"
        case .tableColumn: return "TableColumn"
        case .outline: return "Outline"
        case .outlineRow: return "OutlineRow"
        case .browser: return "Browser"
        case .collectionView: return "CollectionView"
        case .slider: return "Slider"
        case .pageIndicator: return "PageIndicator"
        case .progressIndicator: return "ProgressIndicator"
        case .activityIndicator: return "ActivityIndicator"
        case .segmentedControl: return "SegmentedControl"
        case .picker: return "Picker"
        case .pickerWheel: return "PickerWheel"
        case .switch: return "Switch"
        case .toggle: return "Toggle"
        case .link: return "Link"
        case .image: return "Image"
        case .icon: return "Icon"
        case .searchField: return "SearchField"
        case .scrollView: return "ScrollView"
        case .scrollBar: return "ScrollBar"
        case .staticText: return "StaticText"
        case .textField: return "TextField"
        case .secureTextField: return "SecureTextField"
        case .datePicker: return "DatePicker"
        case .textView: return "TextView"
        case .menu: return "Menu"
        case .menuItem: return "MenuItem"
        case .menuBar: return "MenuBar"
        case .menuBarItem: return "MenuBarItem"
        case .map: return "Map"
        case .webView: return "WebView"
        case .incrementArrow: return "IncrementArrow"
        case .decrementArrow: return "DecrementArrow"
        case .timeline: return "Timeline"
        case .ratingIndicator: return "RatingIndicator"
        case .valueIndicator: return "ValueIndicator"
        case .splitGroup: return "SplitGroup"
        case .splitter: return "Splitter"
        case .relevanceIndicator: return "RelevanceIndicator"
        case .colorWell: return "ColorWell"
        case .helpTag: return "HelpTag"
        case .matte: return "Matte"
        case .dockItem: return "DockItem"
        case .ruler: return "Ruler"
        case .rulerMarker: return "RulerMarker"
        case .grid: return "Grid"
        case .levelIndicator: return "LevelIndicator"
        case .cell: return "Cell"
        case .layoutArea: return "LayoutArea"
        case .layoutItem: return "LayoutItem"
        case .handle: return "Handle"
        case .stepper: return "Stepper"
        case .tab: return "Tab"
        case .touchBar: return "TouchBar"
        case .statusItem: return "StatusItem"
        @unknown default: return "Unknown"
        }
    }

    // MARK: - Response Formatting

    private func successResponse(_ result: Any) -> String {
        let response: [String: Any] = ["success": true, "result": result]
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              let json = String(data: data, encoding: .utf8)
        else {
            return #"{"success":true,"result":{}}"#
        }
        return json
    }

    private func errorResponse(_ message: String) -> String {
        let response: [String: Any] = ["success": false, "error": message]
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              let json = String(data: data, encoding: .utf8)
        else {
            return #"{"success":false,"error":"Unknown error"}"#
        }
        return json
    }
}

// MARK: - Errors

enum RunnerError: Error, CustomStringConvertible {
    case unknownCommand(String)
    case missingParam(String)
    case elementNotFound(String)
    case noElementAtPoint(Double, Double)

    var description: String {
        switch self {
        case .unknownCommand(let cmd): return "Unknown command: \(cmd)"
        case .missingParam(let param): return "Missing required parameter: \(param)"
        case .elementNotFound(let id): return "Element not found: \(id)"
        case .noElementAtPoint(let x, let y): return "No element at point (\(x), \(y))"
        }
    }
}

// MARK: - XCUIElement Focus Extension

extension XCUIElement {
    /// Check if this element currently has keyboard focus.
    var hasKeyboardFocus: Bool {
        (value(forKey: "hasKeyboardFocus") as? Bool) ?? false
    }
}
