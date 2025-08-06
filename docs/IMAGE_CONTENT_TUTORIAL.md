# Returning Image Content in MCP Tool Calls

This tutorial explains how to return image content from MCP (Model Context Protocol) tools using the official MCP SDK. We'll cover the basics, provide practical examples, and show best practices for handling images in your MCP server.

## Prerequisites

- Basic understanding of TypeScript/JavaScript
- Familiarity with the MCP protocol
- MCP SDK installed (`@modelcontextprotocol/sdk`)

## Understanding Image Content Types

The MCP SDK provides specific types for handling image content. Here are the key types you need to know:

```typescript
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";

// Image content structure
type ImageContent = {
  type: "image";
  data: string;        // Base64-encoded image data
  mimeType: string;    // MIME type (e.g., "image/png", "image/jpeg")
};

// Tool result can contain multiple content items
type ToolResult = {
  content: (ImageContent | TextContent)[];
  isError?: boolean;
};
```

## Basic Image Tool Implementation

Here's a simple example of a tool that returns an image:

```typescript
import { Tool } from "./tool"; // Your tool type definition
import type { Context } from "./context"; // Your context type

export const screenshotTool: Tool = {
  schema: {
    name: "screenshot",
    description: "Takes a screenshot of the current page",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  handle: async (context: Context, _params) => {
    // Get image data (this example assumes you have a method to capture screenshots)
    const imageData = await captureScreenshot(context);
    
    return {
      content: [
        {
          type: "image",
          data: imageData,           // Base64-encoded PNG data
          mimeType: "image/png"
        }
      ]
    };
  }
};
```

## Working with Different Image Sources

### 1. From File System

```typescript
import fs from 'fs/promises';
import path from 'path';

export const loadImageTool: Tool = {
  schema: {
    name: "load_image",
    description: "Loads an image from the file system",
    inputSchema: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description: "Path to the image file"
        }
      },
      required: ["filepath"]
    }
  },
  handle: async (context: Context, params) => {
    const { filepath } = params as { filepath: string };
    
    try {
      // Read the image file
      const imageBuffer = await fs.readFile(filepath);
      
      // Convert to base64
      const base64Data = imageBuffer.toString('base64');
      
      // Determine MIME type based on file extension
      const ext = path.extname(filepath).toLowerCase();
      const mimeType = getMimeType(ext);
      
      return {
        content: [
          {
            type: "image",
            data: base64Data,
            mimeType: mimeType
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to load image: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
};

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };
  return mimeTypes[extension] || 'image/png';
}
```

### 2. From URL/HTTP Request

```typescript
export const fetchImageTool: Tool = {
  schema: {
    name: "fetch_image",
    description: "Fetches an image from a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL of the image to fetch"
        }
      },
      required: ["url"]
    }
  },
  handle: async (context: Context, params) => {
    const { url } = params as { url: string };
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Get the image as array buffer
      const arrayBuffer = await response.arrayBuffer();
      
      // Convert to base64
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      
      // Get MIME type from response headers
      const mimeType = response.headers.get('content-type') || 'image/png';
      
      return {
        content: [
          {
            type: "image",
            data: base64Data,
            mimeType: mimeType
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch image: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
};
```

### 3. From Canvas/Generated Images

```typescript
// Example using node-canvas (you'd need to install: npm install canvas)
import { createCanvas } from 'canvas';

export const generateImageTool: Tool = {
  schema: {
    name: "generate_image",
    description: "Generates a simple image with text",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to render in the image"
        },
        width: {
          type: "number",
          description: "Image width",
          default: 400
        },
        height: {
          type: "number",
          description: "Image height",
          default: 200
        }
      },
      required: ["text"]
    }
  },
  handle: async (context: Context, params) => {
    const { text, width = 400, height = 200 } = params as {
      text: string;
      width?: number;
      height?: number;
    };
    
    try {
      // Create canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      
      // Draw background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      // Draw text
      ctx.fillStyle = '#000000';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(text, width / 2, height / 2);
      
      // Convert to base64 PNG
      const base64Data = canvas.toBuffer('image/png').toString('base64');
      
      return {
        content: [
          {
            type: "image",
            data: base64Data,
            mimeType: "image/png"
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to generate image: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
};
```

## Combining Images with Text

You can return both images and text in the same response:

```typescript
export const annotatedScreenshotTool: Tool = {
  schema: {
    name: "annotated_screenshot",
    description: "Takes a screenshot and provides analysis",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  handle: async (context: Context, _params) => {
    const screenshot = await captureScreenshot(context);
    const analysis = await analyzeScreen(context);
    
    return {
      content: [
        {
          type: "text",
          text: `Screenshot Analysis:\n${analysis}`
        },
        {
          type: "image",
          data: screenshot,
          mimeType: "image/png"
        }
      ]
    };
  }
};
```

## Best Practices

### 1. Error Handling

Always wrap image operations in try-catch blocks and provide meaningful error messages:

```typescript
handle: async (context: Context, params) => {
  try {
    const imageData = await getImageData(params);
    return {
      content: [
        {
          type: "image",
          data: imageData,
          mimeType: "image/png"
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Image operation failed: ${error.message}`
        }
      ],
      isError: true
    };
  }
}
```

### 2. MIME Type Validation

Ensure you're using correct MIME types:

```typescript
function validateMimeType(mimeType: string): boolean {
  const validTypes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml'
  ];
  return validTypes.includes(mimeType);
}
```

### 3. Image Size Considerations

Large images can cause performance issues. Consider resizing or compressing:

```typescript
// Example using sharp (npm install sharp)
import sharp from 'sharp';

async function resizeImage(buffer: Buffer, maxWidth: number = 1920): Promise<Buffer> {
  return await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png({ quality: 80 })
    .toBuffer();
}
```

### 4. Base64 Encoding Helpers

Create utility functions for common operations:

```typescript
export class ImageUtils {
  static bufferToBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }
  
  static async fileToBase64(filepath: string): Promise<string> {
    const buffer = await fs.readFile(filepath);
    return this.bufferToBase64(buffer);
  }
  
  static dataUrlToBase64(dataUrl: string): string {
    return dataUrl.split(',')[1];
  }
}
```

## Complete Example: Browser Screenshot Tool

Here's the complete implementation from the browsermcp project:

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
import { ScreenshotTool } from "@repo/types/mcp/tool";
import { Tool } from "./tool";

export const screenshot: Tool = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScreenshotTool.shape.arguments),
  },
  handle: async (context, _params) => {
    // Send message to browser extension via WebSocket
    const screenshot = await context.sendSocketMessage(
      "browser_screenshot",
      {},
    );
    
    return {
      content: [
        {
          type: "image",
          data: screenshot,        // Already base64-encoded PNG from browser
          mimeType: "image/png",
        },
      ],
    };
  },
};
```

## Testing Your Image Tools

When testing image tools, you can verify the output by:

1. **Checking the response structure**:
   ```typescript
   const result = await tool.handle(context, params);
   console.log(result.content[0].type); // Should be "image"
   console.log(result.content[0].mimeType); // Should be valid MIME type
   ```

2. **Validating base64 data**:
   ```typescript
   const isValidBase64 = (str: string) => {
     try {
       return Buffer.from(str, 'base64').toString('base64') === str;
     } catch {
       return false;
     }
   };
   ```

3. **Saving test images**:
   ```typescript
   // For debugging - save the returned image
   const imageBuffer = Buffer.from(result.content[0].data, 'base64');
   await fs.writeFile('test-output.png', imageBuffer);
   ```

## Common Issues and Solutions

### Issue: "Invalid base64 data"
**Solution**: Ensure your image data is properly base64-encoded without data URL prefixes (`data:image/png;base64,`).

### Issue: "Large images causing timeouts"
**Solution**: Implement image compression or resizing before encoding.

### Issue: "Wrong MIME type"
**Solution**: Always set the correct MIME type that matches your image format.

### Issue: "Memory issues with large images"
**Solution**: Process images in streams or chunks for very large files.

## Conclusion

Returning image content in MCP tools is straightforward once you understand the required format. Remember to:

- Use the correct `ImageContent` type structure
- Properly encode images as base64
- Set appropriate MIME types
- Handle errors gracefully
- Consider performance implications for large images

This tutorial should give you everything you need to implement image-returning tools in your MCP server! 
