# Contributing to iOS Simulator MCP

Thank you for your interest in contributing to the iOS Simulator MCP server! This guide outlines our contribution process and project philosophy.

## Project Philosophy

This project is **intentionally simple** and follows these core principles:

### Simplicity First

- **Single file architecture**: All logic is contained in `src/index.ts` to simplify bundling and maintenance
- **Minimal dependencies**: We keep dependencies minimal to ensure fast installs and small footprint on user machines
- **Standard tooling**: We use `npm` (universally available) and `tsc` (simple, already available) for building

### Real Use Cases Only

- New tools should be driven by **real use cases**, not hypothetical situations
- We are **not trying to include every possible tool** - additional tools can pollute context windows and confuse AI agents
- The original use case: Give AI editors the ability to interact with iOS simulators like a user, similar to [playwright-mcp](https://github.com/microsoft/playwright-mcp) for browsers
- This enables autonomous agent loops where AI can validate its own work in the iOS simulator

### Architectural Stability

- **No significant architecture changes** without prior discussion
- Major changes must be discussed with the author beforehand via GitHub issues or DMs
- Changes should address real pain points that cannot be solved by existing implementation or configuration

## Prerequisites

Before contributing, ensure you have:

- **macOS** (iOS simulators only work on macOS)
- **Node.js** installed
- **Xcode** and iOS simulators installed
- **Facebook IDB** tool installed ([installation guide](https://fbidb.io/docs/installation))
- An **MCP client** (like Cursor) for testing

For additional context and references, see [CONTEXT.md](CONTEXT.md) which contains helpful links for MCP development, iOS simulator commands, and security considerations.

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/your-username/ios-simulator-mcp.git
   cd ios-simulator-mcp
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build the project**

   ```bash
   npm run build
   ```

4. **Test during development**

   ```bash
   # Watch mode for development
   npm run watch

   # Test with MCP inspector
   npm run dev
   ```

## Dependency Management & Upgrades

To maintain maximum compatibility with the MCP ecosystem, we align our dependencies with those used by `@modelcontextprotocol/sdk`. This ensures seamless integration and reduces potential conflicts.

### Current Dependency Strategy

- **`@modelcontextprotocol/sdk`**: Always use the latest stable version
- **`zod`**: Match the version used by `@modelcontextprotocol/sdk` (currently `^3.23.8`)
- **`typescript`**: Match the version used by `@modelcontextprotocol/sdk` (currently `^5.5.4`)
- **`@types/node`**: Match the version used by `@modelcontextprotocol/sdk` (currently `^22.0.2`)

### Checking for Updates

Before upgrading dependencies, check what versions the MCP SDK uses:

```bash
# Check MCP SDK dependencies
npm info @modelcontextprotocol/sdk dependencies

# Check MCP SDK dev dependencies
npm info @modelcontextprotocol/sdk devDependencies

# Compare with current project dependencies
npm ls --depth=0
```

### Upgrading Dependencies

1. **Check MCP SDK versions first**:

   ```bash
   npm info @modelcontextprotocol/sdk dependencies devDependencies
   ```

2. **Update package.json to match**:

   - Update `zod` to match MCP SDK version
   - Update `typescript` to match MCP SDK version
   - Update `@types/node` to match MCP SDK version
   - Keep `@modelcontextprotocol/sdk` at latest stable

3. **Install and test**:

   ```bash
   npm install
   npm run build
   npm run dev  # Test with MCP inspector
   ```

4. **Verify compatibility**:
   - Test all existing functionality
   - Run through the test cases in [QA.md](QA.md)
   - Ensure no new TypeScript errors

### Why This Matters

- **Compatibility**: Ensures our tools work seamlessly with MCP clients
- **Stability**: Reduces version conflicts and unexpected behavior
- **Consistency**: Maintains a predictable development environment
- **Future-proofing**: Easier to adopt new MCP SDK features and fixes

### When to Deviate

Only deviate from MCP SDK dependency versions when:

- A security vulnerability requires a newer version
- A critical bug fix is only available in a newer version
- The MCP SDK explicitly supports newer versions

In such cases, document the deviation and reasoning in the pull request.

## Making Changes

### Code Style

- Follow the existing TypeScript patterns in the codebase
- Use the existing error handling patterns with `toError()` and `errorWithTroubleshooting()`
- Maintain the single-file architecture - all logic stays in `src/index.ts`

### Adding New Tools

Before adding a new tool, ask yourself:

1. **Is this driven by a real use case?** Provide specific examples of when this tool would be needed
2. **Can existing tools solve this problem?** Check if current functionality can address the need
3. **Will this add significant value without cluttering the context?** Consider the trade-off between utility and complexity

If adding a new tool:

1. Follow the existing pattern with `isToolFiltered()` check
2. Use proper Zod schemas for input validation
3. Include comprehensive error handling with troubleshooting links
4. Use the `--` separator when passing user input to commands (security best practice)
5. Add the tool to the README.md documentation

### Dependency Updates in Pull Requests

When submitting pull requests:

1. **Check dependency alignment** with MCP SDK before submitting
2. **Include dependency changes** in a separate commit when possible
3. **Document any deviations** from MCP SDK versions with clear reasoning
4. **Test thoroughly** after dependency updates to ensure compatibility

### Security Considerations

- Always use the `--` separator when passing user-provided arguments to shell commands
- Validate all inputs using Zod schemas
- Use `execFileAsync` with `shell: false` to prevent command injection
- Follow the existing patterns for UDID validation and path handling

For more security context, see the command injection resources in [CONTEXT.md](CONTEXT.md).

## Testing Requirements

Due to the nature of this project, **manual testing is required** for all changes:

### Why Manual Testing?

- Requires a real macOS device
- Needs a running iOS simulator
- Requires an MCP client with a real LLM
- Limited development budget (hobby project without sponsorship)

### Testing Process

1. **Build your changes**

   ```bash
   npm run build
   ```

2. **Configure your MCP client** (e.g., Cursor) to use your local build:

   ```json
   {
     "mcpServers": {
       "ios-simulator": {
         "command": "node",
         "args": ["/full/path/to/your/ios-simulator-mcp/build/index.js"]
       }
     }
   }
   ```

3. **Start an iOS simulator**

   ```bash
   xcrun simctl list devices
   xcrun simctl boot "iPhone 15"  # or your preferred device
   ```

4. **Test thoroughly in your MCP client**
   - Test all affected functionality
   - Test error conditions
   - Verify the tool works as expected with AI agents
   - Consider running the test cases in [QA.md](QA.md) to ensure existing functionality still works

### Required Documentation for Contributions

Include in your pull request:

- **Step-by-step testing instructions**
- **Screenshots or video** of the functionality working
- **Description of the real use case** that drove this change
- **Confirmation that existing functionality still works**

## Submitting Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the guidelines above

3. **Test thoroughly** using the manual testing process

4. **Update documentation** if needed:

   - Add new tools to README.md
   - Update any relevant documentation

5. **Submit a pull request** with:
   - Clear description of the change and motivation
   - Step-by-step testing instructions
   - Screenshots/video of manual testing
   - Confirmation of real use case

## Release Process

- Releases are managed through the GitHub releases page
- The pipeline uses standard `npm publish` commands
- Version bumping and release timing are handled by the maintainer

## Questions or Discussions

For significant changes or questions:

- Open a GitHub issue for discussion
- Reach out via DMs for architectural discussions
- Provide context about your specific use case

## Code of Conduct

- Be respectful and constructive in all interactions
- Focus on real use cases and practical solutions
- Respect the project's philosophy of intentional simplicity
- Provide thorough testing and documentation for contributions

Thank you for helping make iOS Simulator MCP better! 🚀
