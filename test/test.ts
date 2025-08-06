#!/usr/bin/env node

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds
const TEST_OUTPUT_DIR = path.join(os.tmpdir(), "ios-simulator-mcp-test");

// Ensure test output directory exists
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class TestRunner {
  private results: TestResult[] = [];

  async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    console.log(`🧪 Running test: ${name}`);
    
    try {
      await Promise.race([
        testFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Test timeout")), TEST_TIMEOUT)
        )
      ]);
      
      const duration = Date.now() - startTime;
      this.results.push({ name, passed: true, duration });
      console.log(`✅ ${name} - PASSED (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMessage, duration });
      console.log(`❌ ${name} - FAILED (${duration}ms): ${errorMessage}`);
    }
  }

  printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log("\n" + "=".repeat(50));
    console.log("TEST SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total tests: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total time: ${totalTime}ms`);
    
    if (failed > 0) {
      console.log("\nFAILED TESTS:");
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

    process.exit(failed > 0 ? 1 : 0);
  }
}

// Utility functions
function isValidBase64(str: string): boolean {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch {
    return false;
  }
}

function isValidMimeType(mimeType: string): boolean {
  const validTypes = [
    'image/png',
    'image/jpeg', 
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/tiff',
    'image/bmp'
  ];
  return validTypes.includes(mimeType);
}

async function callMcpTool(toolName: string, params: any = {}): Promise<any> {
  const mcpRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: params
    }
  };

  const process = execFile("node", ["src/index.ts"], {
    cwd: "/Users/samholmes/Developer/ios-simulator-mcp"
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    // Send the request
    process.stdin?.write(JSON.stringify(mcpRequest) + "\n");
    process.stdin?.end();

    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}. stderr: ${stderr}`));
        return;
      }

      try {
        // Parse the JSON-RPC response from stdout
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              if (response.id === 1) {
                if (response.error) {
                  reject(new Error(`MCP Error: ${response.error.message}`));
                } else {
                  resolve(response.result);
                }
                return;
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
        }
        reject(new Error("No valid JSON-RPC response found"));
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error}`));
      }
    });

    process.on("error", (error) => {
      reject(error);
    });
  });
}

async function checkSimulatorAvailable(): Promise<void> {
  try {
    const { stdout } = await execFileAsync("xcrun", ["simctl", "list", "devices"]);
    if (!stdout.includes("Booted")) {
      throw new Error("No booted iOS simulator found. Please start a simulator before running tests.");
    }
  } catch (error) {
    throw new Error(`Failed to check simulator status: ${error}`);
  }
}

// Test cases
async function testGetBootedSimId(): Promise<void> {
  const result = await callMcpTool("get_booted_sim_id");
  
  if (!result.content || !Array.isArray(result.content)) {
    throw new Error("Expected content array in response");
  }

  const textContent = result.content.find((c: any) => c.type === "text");
  if (!textContent || !textContent.text) {
    throw new Error("Expected text content with simulator info");
  }

  if (!textContent.text.includes("UUID:")) {
    throw new Error("Expected UUID in response text");
  }
}

async function testUiView(): Promise<void> {
  const result = await callMcpTool("ui_view");
  
  if (!result.content || !Array.isArray(result.content)) {
    throw new Error("Expected content array in response");
  }

  const imageContent = result.content.find((c: any) => c.type === "image");
  if (!imageContent) {
    throw new Error("Expected image content in response");
  }

  if (!imageContent.data || !isValidBase64(imageContent.data)) {
    throw new Error("Expected valid base64 image data");
  }

  if (imageContent.mimeType !== "image/jpeg") {
    throw new Error(`Expected image/jpeg MIME type, got: ${imageContent.mimeType}`);
  }

  // Save test image for manual verification
  const imageBuffer = Buffer.from(imageContent.data, 'base64');
  const testImagePath = path.join(TEST_OUTPUT_DIR, "ui_view_test.jpg");
  fs.writeFileSync(testImagePath, imageBuffer);
  console.log(`  📸 Test image saved to: ${testImagePath}`);
}

async function testScreenshot(): Promise<void> {
  // Test PNG format
  const pngResult = await callMcpTool("screenshot", { type: "png" });
  
  if (!pngResult.content || !Array.isArray(pngResult.content)) {
    throw new Error("Expected content array in PNG response");
  }

  const pngImageContent = pngResult.content.find((c: any) => c.type === "image");
  if (!pngImageContent) {
    throw new Error("Expected image content in PNG response");
  }

  if (!pngImageContent.data || !isValidBase64(pngImageContent.data)) {
    throw new Error("Expected valid base64 PNG image data");
  }

  if (pngImageContent.mimeType !== "image/png") {
    throw new Error(`Expected image/png MIME type, got: ${pngImageContent.mimeType}`);
  }

  // Test JPEG format with compression
  const jpegResult = await callMcpTool("screenshot", { 
    type: "jpeg", 
    compress: true 
  });
  
  const jpegImageContent = jpegResult.content.find((c: any) => c.type === "image");
  if (!jpegImageContent) {
    throw new Error("Expected image content in JPEG response");
  }

  if (jpegImageContent.mimeType !== "image/jpeg") {
    throw new Error(`Expected image/jpeg MIME type, got: ${jpegImageContent.mimeType}`);
  }

  // Save test images
  const pngBuffer = Buffer.from(pngImageContent.data, 'base64');
  const jpegBuffer = Buffer.from(jpegImageContent.data, 'base64');
  
  fs.writeFileSync(path.join(TEST_OUTPUT_DIR, "screenshot_test.png"), pngBuffer);
  fs.writeFileSync(path.join(TEST_OUTPUT_DIR, "screenshot_compressed_test.jpg"), jpegBuffer);
  
  console.log(`  📸 PNG test image saved to: ${path.join(TEST_OUTPUT_DIR, "screenshot_test.png")}`);
  console.log(`  📸 JPEG test image saved to: ${path.join(TEST_OUTPUT_DIR, "screenshot_compressed_test.jpg")}`);
}



async function testUiDescribeAll(): Promise<void> {
  const result = await callMcpTool("ui_describe_all");
  
  if (!result.content || !Array.isArray(result.content)) {
    throw new Error("Expected content array in response");
  }

  const textContent = result.content.find((c: any) => c.type === "text");
  if (!textContent || !textContent.text) {
    throw new Error("Expected text content with UI description");
  }

  // Should be valid JSON
  try {
    JSON.parse(textContent.text);
  } catch {
    throw new Error("Expected valid JSON in UI description");
  }
}

// Main test execution
async function main(): Promise<void> {
  console.log("🚀 Starting iOS Simulator MCP Server Tests\n");
  
  const runner = new TestRunner();

  // Pre-flight checks
  await runner.runTest("Pre-flight: Check simulator availability", checkSimulatorAvailable);

  // Core functionality tests
  await runner.runTest("Get booted simulator ID", testGetBootedSimId);
  await runner.runTest("UI describe all", testUiDescribeAll);

  // Image content tests
  await runner.runTest("UI view (compressed JPEG)", testUiView);
  await runner.runTest("Screenshot (PNG and JPEG)", testScreenshot);

  // Print results
  runner.printSummary();
}

// Run tests
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Test runner failed:", error);
    process.exit(1);
  });
} 
