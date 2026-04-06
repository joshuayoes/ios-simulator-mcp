#!/bin/bash
# Build the XCUITest runner bundle for deployment to iOS Simulators.
#
# This script compiles the XCUITest target and generates an .xctestrun file
# that can be used with `xcodebuild test-without-building` to deploy the
# command server to any simulator.
#
# Usage:
#   ./build-runner.sh [--destination <platform>]
#
# The built artifacts are placed in build/XCTestRunner/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
BUILD_DIR="${SCRIPT_DIR}/../../build/XCTestRunner"

# Default to latest iOS Simulator
DESTINATION="${1:-platform=iOS Simulator,name=iPhone 16}"

echo "Building XCUITest runner..."
echo "  Project: $PROJECT_DIR"
echo "  Output:  $BUILD_DIR"

# Build for testing (generates the .xctestrun and test bundle)
xcodebuild build-for-testing \
    -project "$PROJECT_DIR/SimulatorMCPRunner.xcodeproj" \
    -scheme "SimulatorMCPRunnerUITests" \
    -destination "$DESTINATION" \
    -derivedDataPath "$BUILD_DIR/DerivedData" \
    -quiet

# Find the generated .xctestrun file
XCTESTRUN_FILE=$(find "$BUILD_DIR/DerivedData" -name "*.xctestrun" -type f | head -1)

if [ -z "$XCTESTRUN_FILE" ]; then
    echo "Error: No .xctestrun file found after build"
    exit 1
fi

# Copy the .xctestrun to a well-known location
cp "$XCTESTRUN_FILE" "$BUILD_DIR/SimulatorMCPRunner.xctestrun"

echo "Build complete!"
echo "  xctestrun: $BUILD_DIR/SimulatorMCPRunner.xctestrun"
echo ""
echo "To deploy to a simulator:"
echo "  xcodebuild test-without-building \\"
echo "    -xctestrun $BUILD_DIR/SimulatorMCPRunner.xctestrun \\"
echo "    -destination 'platform=iOS Simulator,id=<UDID>'"
