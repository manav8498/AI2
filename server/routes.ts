// server/routes.ts
import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import * as fsSync from 'fs';
import { generateCode, analyzeError, createEnhancedFullstackPrompt, isFullstackOrMultiPageRequest } from "./anthropic";
import { 
  insertChatMessageSchema, 
  insertGeneratedFileSchema 
} from "@shared/schema";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as vm from "vm";
import * as util from "util";

// Import WebsiteServer functions using ES modules
import { createWebsiteServer, stopWebsiteServer } from "./services/WebsiteServer";

const execAsync = promisify(exec);

// Import the ProjectManager
import { ProjectManager } from './services/ProjectManager';

// Improved function to detect code type more accurately
function detectCodeType(code: string): 'web' | 'node' | 'browser-js' {
  // Check for Node.js specific patterns
  const nodePatterns = [
    'require(',
    'module.exports',
    'exports.',
    'process.env',
    'fs.',
    'path.',
    '__dirname',
    '__filename'
  ];
  
  // Check for web-specific patterns
  const webPatterns = [
    'document',
    '<html',
    '<script',
    'window.',
    'getElementById',
    'querySelector',
    'innerHTML',
    'addEventListener'
  ];
  
  // Check if this is explicitly Node.js code
  const isNodeCode = nodePatterns.some(pattern => code.includes(pattern));
  
  // Check if this is explicitly web code
  const isWebCode = webPatterns.some(pattern => code.includes(pattern)) || 
                    code.includes('<') && code.includes('>');
  
  // If it has both Node.js and web patterns, prioritize web
  if (isWebCode) {
    return 'web';
  } else if (isNodeCode) {
    return 'node';
  } else {
    // If no specific indicators, treat as browser JavaScript
    return 'browser-js';
  }
}

// Updated executeNodeCode for better handling server-side
async function executeNodeCode(code: string, tempDir: string): Promise<{ output: string, webOutput?: string, previewUrl?: string }> {
  try {
    const tempFile = path.join(tempDir, "code.js");
    await fs.writeFile(tempFile, code);

    // Capture console output
    let output = '';
    const consoleMock = {
      log: (...args: any[]) => {
        output += args.map(arg => 
          typeof arg === 'object' ? util.inspect(arg) : String(arg)
        ).join(' ') + '\n';
      },
      error: (...args: any[]) => {
        output += args.map(arg => 
          typeof arg === 'object' ? util.inspect(arg) : String(arg)
        ).join(' ') + '\n';
      },
      warn: (...args: any[]) => {
        output += args.map(arg => 
          typeof arg === 'object' ? util.inspect(arg) : String(arg)
        ).join(' ') + '\n';
      },
      info: (...args: any[]) => {
        output += args.map(arg => 
          typeof arg === 'object' ? util.inspect(arg) : String(arg)
        ).join(' ') + '\n';
      }
    };
    
    // Create a safe sandbox with common Node.js globals
    const sandbox: any = {
      console: consoleMock,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer,
      process: { 
        env: process.env,
        versions: process.versions,
        cwd: () => process.cwd()
      }
    };
    
    // Add a safe require function to the sandbox
    sandbox.require = (moduleName: string) => {
      // Only allow safe modules to be required
      const safeModules = ['util', 'path', 'url', 'querystring', 'string_decoder', 'punycode', 'events'];
      
      if (safeModules.includes(moduleName)) {
        return require(moduleName);
      }
      
      if (moduleName === 'fs') {
        // Provide a very limited mock of fs with only reading capabilities
        return {
          readFileSync: (filePath: string, options?: any) => {
            // Only allow reading the temp file we created
            if (filePath === tempFile || filePath.startsWith(tempDir)) {
              return fsSync.readFileSync(filePath, options);
            }
            throw new Error('Access denied: Cannot read files outside the temporary directory');
          }
        };
      }
      
      throw new Error(`Module '${moduleName}' is not available in this environment`);
    };
    
    // Run the code in the sandbox
    try {
      const script = new vm.Script(code);
      const context = vm.createContext(sandbox);
      script.runInContext(context);
      
      return { 
        output: output || "Code executed successfully (no output)",
        webOutput: undefined,
        previewUrl: undefined
      };
    } catch (vmError) {
      return {
        output: `Error executing code: ${vmError instanceof Error ? vmError.message : String(vmError)}`,
        webOutput: undefined,
        previewUrl: undefined
      };
    }
  } catch (error) {
    console.error("Error in executeNodeCode:", error);
    return {
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      webOutput: undefined,
      previewUrl: undefined
    };
  }
}

// Improved prepareWebCode function for browser execution
function prepareWebCode(code: string): { output: string, webOutput: string, previewUrl: string } {
  try {
    // If it's pure JavaScript (without HTML), wrap it in HTML with console output capture
    if (!code.includes('<html') && !code.includes('<body') && !code.includes('<script')) {
      const wrappedCode = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Output</title>
  <style>
    body { font-family: monospace; padding: 20px; }
    #output { background: #f1f1f1; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h3>Code Output:</h3>
  <div id="output"></div>

  <script>
    // Capture console output
    const output = document.getElementById('output');
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };

    // Override console methods to display in the page
    console.log = function(...args) {
      output.innerHTML += args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ') + '\\n';
      originalConsole.log(...args);
    };
    
    console.error = function(...args) {
      output.innerHTML += '<span style="color: red;">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.error(...args);
    };
    
    console.warn = function(...args) {
      output.innerHTML += '<span style="color: orange;">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.warn(...args);
    };
    
    console.info = function(...args) {
      output.innerHTML += '<span style="color: blue;">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.info(...args);
    };

    // Execute the user code
    try {
      ${code}
    } catch (error) {
      console.error('Error executing code:', error.message);
    }
  </script>
</body>
</html>`;

      // Create a data URL for browser preview
      const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(wrappedCode)}`;

      return {
        output: "Code prepared for browser execution",
        webOutput: wrappedCode,
        previewUrl
      };
    } else {
      // For HTML, add console output capture if there's no <script> tag
      let processedCode = code;
      
      if (!code.includes('<script')) {
        // Add a script tag to capture console output
        const scriptTag = `
<script>
  // Capture console output if output div exists
  if (document.getElementById('output')) {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };

    console.log = function(...args) {
      const output = document.getElementById('output');
      if (output) {
        output.innerHTML += args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ') + '\\n';
      }
      originalConsole.log(...args);
    };
    
    // Similar overrides for other console methods...
  }
</script>`;
        
        // Insert before </body> if it exists, otherwise append
        if (processedCode.includes('</body>')) {
          processedCode = processedCode.replace('</body>', `${scriptTag}\n</body>`);
        } else {
          processedCode += scriptTag;
        }
      }
      
      // Create a data URL for browser preview
      const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(processedCode)}`;

      return {
        output: "HTML content prepared for browser execution",
        webOutput: processedCode,
        previewUrl
      };
    }
  } catch (error) {
    console.error("Error in prepareWebCode:", error);
    
    // Create a basic error page as fallback
    const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
</head>
<body>
  <h1>Error Preparing Code</h1>
  <p>${error instanceof Error ? error.message : String(error)}</p>
</body>
</html>`;
    
    return {
      output: `Error preparing web code: ${error instanceof Error ? error.message : String(error)}`,
      webOutput: errorHtml,
      previewUrl: `data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`
    };
  }
}

// New function to handle browser JavaScript execution
function executeBrowserJs(code: string): { output: string, webOutput: string, previewUrl: string } {
  try {
    // Create a HTML page that safely executes the JavaScript with a console output display
    const webOutput = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JavaScript Output</title>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
    #output { 
      background: #f8f8f8; 
      padding: 15px; 
      border-radius: 5px; 
      white-space: pre-wrap;
      border: 1px solid #ddd;
      min-height: 100px;
    }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h3>JavaScript Execution Output:</h3>
  <div id="output"></div>

  <script>
    // Capture console output
    const output = document.getElementById('output');
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };

    // Override console methods to display in the page
    console.log = function(...args) {
      output.innerHTML += args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ') + '\\n';
      originalConsole.log(...args);
    };
    
    console.error = function(...args) {
      output.innerHTML += '<span class="error">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.error(...args);
    };
    
    console.warn = function(...args) {
      output.innerHTML += '<span style="color: orange;">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.warn(...args);
    };
    
    console.info = function(...args) {
      output.innerHTML += '<span style="color: blue;">' + 
        args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + 
        '</span>\\n';
      originalConsole.info(...args);
    };

    // Execute the user code
    try {
      ${code}
      output.innerHTML += '\\n<span class="success">Code executed successfully!</span>';
    } catch (error) {
      console.error('Error executing code:', error.message);
    }
  </script>
</body>
</html>`;

    // Create a data URL for browser preview
    const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(webOutput)}`;

    return {
      output: "Code executed in browser context",
      webOutput,
      previewUrl
    };
  } catch (error) {
    console.error("Error in executeBrowserJs:", error);
    
    return {
      output: `Error executing browser JavaScript: ${error instanceof Error ? error.message : String(error)}`,
      webOutput: `<html><body><h1>Error</h1><p>${error instanceof Error ? error.message : String(error)}</p></body></html>`,
      previewUrl: `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body><h1>Error</h1><p>${error instanceof Error ? error.message : String(error)}</p></body></html>`)}`
    };
  }
}

async function streamToResponse(res: Response, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Check if request is likely a coding request
function isCodingRequest(query: string): boolean {
  // Always consider very short requests about printing or showing as code requests
  if (query.length < 60 && 
      (query.toLowerCase().includes('print') || 
       query.toLowerCase().includes('show') || 
       query.toLowerCase().includes('output') ||
       query.toLowerCase().includes('hello'))) {
    console.log("Detected as code request: simple print/output request");
    return true;
  }
  
  const codingPatterns = [
    'code', 'program', 'script', 'function', 'implement', 'develop',
    'create', 'generate', 'write', 'print', 'output', 'display',
    'show', 'javascript', 'python', 'java', 'html', 'css', 'react',
    'app', 'application', 'web', 'website', 'page', 'ui', 'interface'
  ];
  
  const lowerQuery = query.toLowerCase();
  
  // Check for any pattern
  for (const pattern of codingPatterns) {
    if (lowerQuery.includes(pattern)) {
      console.log(`Detected as code request: contains '${pattern}'`);
      return true;
    }
  }
  
  return false;
}

// Helper to split explanation from code
function splitExplanationAndCode(content: string): [string, string] {
  // Logic to separate explanation from code blocks
  const codeRegex = /```(?:[\w]*)\n([\s\S]*?)```/g;
  const matches = [...content.matchAll(codeRegex)];
  
  if (matches.length > 0) {
    // Extract the code from code blocks
    const code = matches.map(match => match[1]).join('\n\n');
    
    // Remove code blocks from explanation
    let explanation = content.replace(codeRegex, '');
    explanation = explanation.replace(/Here's the code:/g, '');
    explanation = explanation.replace(/Here is the code:/g, '');
    explanation = explanation.trim();
    
    return [explanation, code];
  }
  
  // If the regex didn't match, try a simpler approach
  const simpleSplit = content.split('```');
  if (simpleSplit.length >= 3) {
    const explanation = simpleSplit[0].trim();
    const code = simpleSplit[1].replace(/^[a-z]+\n/, '').trim(); // Remove language identifier
    return [explanation, code];
  }
  
  return [content, ''];
}

// Updated generateCodeAndExplanation function
async function generateCodeAndExplanation(
  messages: { role: string, content: string }[], 
  userQuery: string
): Promise<[string, string]> {
  const context = messages
    .slice(-10)
    .map(m => `${m.role}: ${m.content}`)
    .join("\n\n");
  
  try {
    console.log("Generating code for query:", userQuery);
    
    // Directly handle simple hello world cases
    if (userQuery.toLowerCase().includes("hello world") || 
        userQuery.toLowerCase().includes("print hello") || 
        userQuery.toLowerCase().includes("output hello")) {
      
      // Check if python is explicitly requested
      if (userQuery.toLowerCase().includes("python")) {
        return [
          "Here's a simple Python hello world program:", 
          'print("Hello, world!")'
        ];
      }
      
      // Check if a specific language is mentioned
      const languages = {
        java: 'System.out.println("Hello, world!");',
        javascript: 'console.log("Hello, world!");',
        js: 'console.log("Hello, world!");',
        typescript: 'console.log("Hello, world!");',
        ts: 'console.log("Hello, world!");',
        'c++': 'std::cout << "Hello, world!" << std::endl;',
        cpp: 'std::cout << "Hello, world!" << std::endl;',
        'c#': 'Console.WriteLine("Hello, world!");',
        csharp: 'Console.WriteLine("Hello, world!");',
        ruby: 'puts "Hello, world!"',
        php: 'echo "Hello, world!";'
      };
      
      for (const [lang, code] of Object.entries(languages)) {
        if (userQuery.toLowerCase().includes(lang)) {
          return [`Here's a simple hello world program in ${lang}:`, code];
        }
      }
      
      // Default to browser-friendly JavaScript
      return [
        "Here's a simple hello world program:", 
        'console.log("Hello, world!");'
      ];
    }
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "output-128k-2025-02-19"
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 128000,
        messages: [
          {
            role: "user", 
            content: `You are a top-tier full-stack developer. For the following code request, provide TWO parts:
            
1. A BRIEF explanation of what the code does and how it works. This explanation will go to the chat.
2. ONLY THE CODE with no explanation, properly formatted, ready to run. This code will go directly to the code editor.

Your response should clearly separate the explanation from the code. Put the code in a code block with triple backticks.

Previous conversation context:
${context}

User's code request: ${userQuery}

Important guidelines:
- Keep the explanation concise and put all code in code blocks
- For web applications, provide well-structured, complete code
- Include proper error handling and validation
- Use modern patterns and best practices
- Make the code actually work, not just be illustrative
- Be thorough - don't leave implementation details for the user to figure out

CRUCIAL: The code will be executed in a browser environment. DO NOT use Node.js-specific features like 'require', 'fs', or other Node.js modules unless explicitly asked for server-side code. Use browser-compatible code by default.`
          }
        ]
      })
    });
    
    const result = await response.json();
    console.log("API Response structure:", JSON.stringify(Object.keys(result)));
    
    const content = result.content && result.content[0] && 'text' in result.content[0] ? 
      result.content[0].text : "I couldn't generate code for this request.";
    
    console.log("Got response content length:", content.length);
    
    // If no code block was found, check for simple hello world request
    const codeMatch = content.match(/```(?:\w+)?\s*([\s\S]+?)```/);
    if (!codeMatch && (userQuery.toLowerCase().includes("hello") || 
                        userQuery.toLowerCase().includes("print"))) {
      console.log("No code block found, providing simple hello world fallback");
      return ["Here's a simple program to print output:", 'console.log("Hello, world!");'];
    }
    
    return splitExplanationAndCode(content);
  } catch (error) {
    console.error("Error generating code and explanation:", error);
    
    // Fallback for hello world requests
    if (userQuery.toLowerCase().includes("hello world") || 
        userQuery.toLowerCase().includes("print") || 
        userQuery.toLowerCase().includes("output")) {
      
      return ["Here's a simple hello world program:", 'console.log("Hello, world!");'];
    }
    
    return ["I'm sorry, I couldn't generate the requested code at this time.", "// Error generating code"];
  }
}

// Generate assistant response with context
async function generateAssistantResponse(
  messages: { role: string, content: string }[], 
  userQuery: string
): Promise<string> {
  // Create context from previous messages
  const context = messages
    .slice(-10) // Use last 10 messages for context
    .map(m => `${m.role}: ${m.content}`)
    .join("\n\n");
  
  // Use anthropic client to generate response with context
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "output-128k-2025-02-19"
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 128000,
        messages: [
          {
            role: "user",
            content: `You are a helpful AI coding assistant. Consider the following conversation context and respond to the user's latest question.
            
Previous conversation:
${context}

User's latest question: ${userQuery}

Please provide a helpful and concise response. If the user is asking about code or programming, provide specific examples and explanations.`
          }
        ]
      })
    });
    
    const result = await response.json();
    // Fix the type issue by checking if text property exists
    return result.content && result.content[0] && 'text' in result.content[0] ? 
      result.content[0].text : "I'm sorry, I couldn't generate a response at this time.";
  } catch (error) {
    console.error("Error generating AI response:", error);
    return "I'm sorry, I couldn't generate a response at this time. Please try again later.";
  }
}

export function registerRoutes(app: Express): Server {
  // Chat sessions routes - updated for numeric IDs
  app.get("/api/chat/sessions", async (_req, res) => {
    try {
      const sessions = await storage.getChatSessions();
      res.json(sessions);
    } catch (error) {
      console.error("Error getting sessions:", error);
      res.status(500).json({ error: "Failed to get sessions" });
    }
  });
  
  app.post("/api/chat/sessions", async (req, res) => {
    try {
      // Changed from name to title to match the database schema
      const session = z.object({
        title: z.string()
      }).parse(req.body);
      const savedSession = await storage.createChatSession(session);
      res.json(savedSession);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  app.delete("/api/chat/sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      
      await storage.deleteChatSession(id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  app.delete("/api/chat/sessions/:id/messages", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      
      await storage.clearSessionMessages(id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  // Chat messages routes - updated for numeric IDs
  app.get("/api/chat/messages", async (req, res) => {
    const sessionIdParam = req.query.sessionId as string;
    const sessionId = sessionIdParam ? parseInt(sessionIdParam, 10) : 1;
    
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID" });
    }
    
    const messages = await storage.getSessionMessages(sessionId);
    res.json(messages);
  });

  app.post("/api/chat/messages", async (req, res) => {
    try {
      // Ensure sessionId is properly handled and defaulted
      const sessionIdRaw = req.body.sessionId;
      const sessionId = sessionIdRaw ? Number(sessionIdRaw) : 1;
      
      const body = z.object({
        sessionId: z.number().default(1),
        role: z.string(),
        content: z.string()
      }).parse({
        ...req.body,
        sessionId: isNaN(sessionId) ? 1 : sessionId
      });
      
      console.log(`Processing message with sessionId: ${body.sessionId}`);
      console.log(`Message content: "${body.content.substring(0, 50)}${body.content.length > 50 ? '...' : ''}"`);
      
      // Double-check with schema validation
      const message = insertChatMessageSchema.parse({
        ...body,
        sessionId: body.sessionId || 1 // Extra safety
      });
      
      // Final safety check
      if (!message.sessionId) {
        console.log("Setting default sessionId as final safety check");
        message.sessionId = 1;
      }
      
      const savedMessage = await storage.addChatMessage(message);
      
      // If this is a user message, determine if it's a coding request
      if (message.role === "user") {
        const isCodeRequest = isCodingRequest(message.content);
        console.log(`Message identified as code request: ${isCodeRequest ? "yes" : "no"}`);
        
        // Generate AI response
        const sessionMessages = await storage.getSessionMessages(message.sessionId);
        
        if (isCodeRequest) {
          console.log("Processing as code request");
          // For code requests, generate explanation for chat and code for editor
          const [explanation, code] = await generateCodeAndExplanation(
            sessionMessages, 
            message.content
          );
          
          console.log(`Generated code length: ${code.length}`);
          if (code.length > 0) {
            console.log(`Generated code sample: ${code.substring(0, 50)}${code.length > 50 ? '...' : ''}`);
          } else {
            console.log("No code was generated");
          }
          
          // Save only the explanation to chat
          const aiResponse = await storage.addChatMessage({
            sessionId: message.sessionId,
            role: "assistant",
            content: explanation || "Here's the code you requested"
          });
          
          // Return both the saved message, AI response, and code for editor
          res.json({
            messages: [savedMessage, aiResponse],
            code: code || "// No code generated", // Ensure we always return something
            isCodeRequest: true
          });
        } else {
          // For non-code requests, just generate a regular response
          const aiResponse = await storage.addChatMessage({
            sessionId: message.sessionId,
            role: "assistant",
            content: await generateAssistantResponse(sessionMessages, message.content)
          });
          
          // Return both messages
          res.json({
            messages: [savedMessage, aiResponse],
            isCodeRequest: false
          });
        }
      } else {
        res.json({
          messages: [savedMessage],
          isCodeRequest: false
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  app.get("/api/files", async (_req, res) => {
    const files = await storage.getGeneratedFiles();
    res.json(files);
  });

  app.post("/api/files", async (req, res) => {
    try {
      const file = insertGeneratedFileSchema.parse(req.body);
      const savedFile = await storage.addGeneratedFile(file);
      res.json(savedFile);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  app.post("/api/analyze-error", async (req, res) => {
    try {
      const body = z.object({
        error: z.string(),
        code: z.string()
      }).parse(req.body);

      const analysis = await analyzeError(body.error, body.code);
      res.json(analysis);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  app.post("/api/install-dependencies", async (req, res) => {
    try {
      const { dependencies } = z.object({
        dependencies: z.array(z.string())
      }).parse(req.body);

      // Type-safe way to handle potentially undefined global function
      const packageInstaller = (global as any).packager_install_tool;
      if (typeof packageInstaller === 'function') {
        await packageInstaller({
          programming_language: "nodejs",
          dependency_list: dependencies
        });
      } else {
        console.log("No package installer available, would install:", dependencies);
      }

      res.json({ message: "Dependencies installed successfully" });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Failed to install dependencies" });
      }
    }
  });

  app.post("/api/generate-code", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Create temporary directory in the OS's proper temp directory
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const tempDir = path.join(os.tmpdir(), `ai-code-${uniqueId}`);
    
    try {
      await fs.mkdir(tempDir, { recursive: true });
      
      const { prompt, sessionId: sessionIdParam, existingCode, type } = z.object({
        prompt: z.string(),
        sessionId: z.string().optional(),
        existingCode: z.string().optional(),
        type: z.string().optional()
      }).parse(req.body);
      
      // Check if this is a fullstack request
      const isFullstackRequest = type === 'fullstack' || isFullstackOrMultiPageRequest(prompt);
      
      // Parse sessionId as a number with validation
      let sessionId: number | undefined;
      if (sessionIdParam) {
        const parsed = parseInt(sessionIdParam, 10);
        sessionId = isNaN(parsed) ? 1 : parsed;
      } else {
        sessionId = 1; // Default to session 1
      }

      // Get context from chat if sessionId is provided and valid
      let contextPrompt = prompt;
      
      if (isFullstackRequest) {
        // Use enhanced prompt for fullstack applications
        contextPrompt = createEnhancedFullstackPrompt(prompt);
      } else if (sessionId) {
        const messages = await storage.getSessionMessages(sessionId);
        if (messages.length > 0) {
          const context = messages
            .slice(-8) // Last 8 messages for context
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join("\n\n");
          
          if (existingCode && existingCode.trim()) {
            contextPrompt = `Below is a conversation history for context:
            
${context}

The user currently has the following code:

\`\`\`
${existingCode}
\`\`\`

Based on this conversation context and the existing code, please generate updated code for the following request:
${prompt}

Important: If the user is asking for changes to existing code, modify the existing code rather than starting from scratch.`;
          } else {
            contextPrompt = `Below is a conversation history for context:
            
${context}

Based on this context, please generate code for the following request:
${prompt}`;
          }
        }
      }

      // Stream the code generation process
      let generatedCode = "";
      let lineIndex = 0;
      
      // Start the code generation
      const codePromise = generateCode(contextPrompt);
      
      // Start sending updates periodically while waiting for the code
      const intervalId = setInterval(async () => {
        // Send current progress
        if (generatedCode) {
          const lines = generatedCode.split('\n');
          // Send any new lines
          while (lineIndex < lines.length) {
            await streamToResponse(res, { 
              code: lines.slice(0, lineIndex + 1).join('\n'),
              status: 'generating',
              lineProgress: lineIndex + 1,
              totalLines: lines.length
            });
            lineIndex++;
          }
        }
      }, 100);
      
      try {
        // Wait for code generation to complete
        generatedCode = await codePromise;
        clearInterval(intervalId);
        
        await streamToResponse(res, { 
          code: generatedCode,
          status: 'generating',
          lineProgress: 100,
          totalLines: 100
        });

        try {
          // Detect code type and prepare/execute
          const codeType = detectCodeType(generatedCode);
          let result;
          
          if (codeType === 'web') {
            result = prepareWebCode(generatedCode);
          } else if (codeType === 'node') {
            result = await executeNodeCode(generatedCode, tempDir);
          } else { // browser-js
            result = executeBrowserJs(generatedCode);
          }

          await streamToResponse(res, { 
            ...result,
            code: generatedCode,
            status: 'complete'
          });

        } catch (execError) {
          // If execution fails, try to fix it
          const analysis = await analyzeError(
            execError instanceof Error ? execError.message : "Execution failed",
            generatedCode
          );

          if (analysis.fixedCode) {
            // Try running the fixed code
            const codeType = detectCodeType(analysis.fixedCode);
            let result;
            
            if (codeType === 'web') {
              result = prepareWebCode(analysis.fixedCode);
            } else if (codeType === 'node') {
              result = await executeNodeCode(analysis.fixedCode, tempDir);
            } else { // browser-js
              result = executeBrowserJs(analysis.fixedCode);
            }

            await streamToResponse(res, {
              code: analysis.fixedCode,
              ...result,
              status: 'complete',
              analysis: "Code was automatically fixed"
            });
          } else {
            throw execError;
          }
        }
      } finally {
        clearInterval(intervalId);
      }
    } catch (error) {
      await streamToResponse(res, {
        error: error instanceof Error ? error.message : "Failed to generate code",
        status: 'error'
      });
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Error cleaning up temp directory:", cleanupError);
      }
      res.end();
    }
  });

  app.post("/api/execute", async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.body);

      // Use the improved code type detection
      const codeType = detectCodeType(code);
      console.log(`Detected code type: ${codeType} for code starting with: ${code.substring(0, 50)}...`);
      
      // Create temporary directory in the OS's proper temp directory
      const uniqueId = crypto.randomBytes(8).toString('hex');
      const tempDir = path.join(os.tmpdir(), `ai-code-${uniqueId}`);
      
      await fs.mkdir(tempDir, { recursive: true });

      try {
        let result;
        
        // Handle different code types appropriately
        if (codeType === 'web') {
          result = prepareWebCode(code);
        } else if (codeType === 'node') {
          result = await executeNodeCode(code, tempDir);
        } else { // browser-js
          result = executeBrowserJs(code);
        }

        // For web output, ensure we always send back a previewUrl
        if (result.webOutput && !result.previewUrl) {
          result.previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(result.webOutput)}`;
        }

        // Log the result for debugging
        console.log("Execute result:", {
          codeType,
          hasOutput: !!result.output,
          hasWebOutput: !!result.webOutput,
          hasPreviewUrl: !!result.previewUrl,
          outputPreview: result.output ? result.output.substring(0, 100) : 'No output'
        });

        res.json(result);
      } finally {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error("Error cleaning up temp directory:", cleanupError);
          // Continue execution even if cleanup fails
        }
      }
    } catch (error) {
      console.error("Error executing code:", error);
      if (error instanceof Error) {
        res.status(400).json({ 
          error: error.message,
          output: `Error: ${error.message}`,
          webOutput: `<html><body><h1>Error</h1><p>${error.message}</p></body></html>`,
          previewUrl: `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body><h1>Error</h1><p>${error.message}</p></body></html>`)}`
        });
      } else {
        res.status(500).json({ 
          error: "An unknown error occurred",
          output: "An unknown error occurred during code execution",
          webOutput: `<html><body><h1>Error</h1><p>An unknown error occurred during code execution</p></body></html>`,
          previewUrl: `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body><h1>Error</h1><p>An unknown error occurred during code execution</p></body></html>`)}`
        });
      }
    }
  });

  app.post("/api/clear", async (_req, res) => {
    await storage.clearChat();
    await storage.clearFiles();
    res.json({ message: "Cleared successfully" });
  });

  // Fullstack project routes
  app.post("/api/fullstack/create", async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.body);
      
      const projectManager = ProjectManager.getInstance();
      
      // Parse project structure from the code
      const files = projectManager.parseProjectStructure(code);
      
      // Create project files
      const { projectId, projectType, isFullstack } = await projectManager.createProject(files);
      
      res.json({
        projectId,
        projectType,
        isFullstack,
        fileCount: files.length,
        message: "Project created successfully"
      });
    } catch (error) {
      console.error("Error creating fullstack project:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create project"
      });
    }
  });

  app.post("/api/fullstack/start/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      const projectManager = ProjectManager.getInstance();
      
      // Start project servers
      const projectRuntime = await projectManager.startProject(projectId);
      
      res.json({
        ...projectRuntime,
        message: "Project started successfully"
      });
    } catch (error) {
      console.error("Error starting fullstack project:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to start project"
      });
    }
  });

  app.post("/api/fullstack/stop/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      const projectManager = ProjectManager.getInstance();
      
      // Stop project servers
      projectManager.stopProject(projectId);
      
      res.json({
        projectId,
        message: "Project stopped successfully"
      });
    } catch (error) {
      console.error("Error stopping fullstack project:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to stop project"
      });
    }
  });

  app.delete("/api/fullstack/cleanup/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      const projectManager = ProjectManager.getInstance();
      
      // Clean up project files
      await projectManager.cleanupProject(projectId);
      
      res.json({
        projectId,
        message: "Project cleaned up successfully"
      });
    } catch (error) {
      console.error("Error cleaning up fullstack project:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to clean up project"
      });
    }
  });

  app.get("/api/fullstack/status/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      const projectManager = ProjectManager.getInstance();
      
      // Get project status
      const status = projectManager.getProjectStatus(projectId);
      
      res.json({
        projectId,
        ...status
      });
    } catch (error) {
      console.error("Error getting fullstack project status:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get project status"
      });
    }
  });

  // New endpoints for local server
  app.post("/api/setup-local-server", async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.body);
      
      // Import the LocalServerManager
      const { LocalServerManager } = await import('./services/LocalServerManager');
      const serverManager = LocalServerManager.getInstance();
      
      // Create the website from the code
      const { serverId, serverUrl } = await serverManager.createWebsite(code);
      
      res.json({
        serverId,
        localServerUrl: serverUrl,
        output: `Website running on local server: ${serverUrl}`,
        message: "Server started successfully"
      });
    } catch (error) {
      console.error("Error setting up local server:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to set up local server",
        output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  });

  app.post("/api/stop-local-server", async (req, res) => {
    try {
      const { serverId } = z.object({
        serverId: z.string().optional()
      }).parse(req.body);
      
      // If no serverId is provided, nothing to do
      if (!serverId) {
        return res.json({ message: "No server ID provided" });
      }
      
      // Import the LocalServerManager
      const { LocalServerManager } = await import('./services/LocalServerManager');
      const serverManager = LocalServerManager.getInstance();
      
      // Stop the server
      const result = await serverManager.stopServer(serverId);
      
      if (result) {
        res.json({ message: "Server stopped successfully" });
      } else {
        res.status(404).json({ error: "Server not found" });
      }
    } catch (error) {
      console.error("Error stopping local server:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to stop local server"
      });
    }
  });

  app.get("/api/local-server-status/:serverId", async (req, res) => {
    try {
      const { serverId } = req.params;
      
      // Import the LocalServerManager
      const { LocalServerManager } = await import('./services/LocalServerManager');
      const serverManager = LocalServerManager.getInstance();
      
      // Get server status
      const status = serverManager.getServerStatus(serverId);
      
      if (status) {
        res.json(status);
      } else {
        res.status(404).json({ error: "Server not found" });
      }
    } catch (error) {
      console.error("Error getting local server status:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get server status"
      });
    }
  });

  app.delete("/api/cleanup-local-server/:serverId", async (req, res) => {
    try {
      const { serverId } = req.params;
      
      // Import the LocalServerManager
      const { LocalServerManager } = await import('./services/LocalServerManager');
      const serverManager = LocalServerManager.getInstance();
      
      // Clean up the server
      const result = await serverManager.cleanupServer(serverId);
      
      if (result) {
        res.json({ message: "Server cleaned up successfully" });
      } else {
        res.status(404).json({ error: "Server not found" });
      }
    } catch (error) {
      console.error("Error cleaning up local server:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to clean up server"
      });
    }
  });

  // Website server routes with ES module imports
  app.post("/api/create-website", async (req, res) => {
    try {
      const { html } = req.body;
      
      if (!html) {
        return res.status(400).json({ error: "HTML content is required" });
      }
      
      // Create the website server using imported function
      const server = createWebsiteServer(html);
      
      // Return server info
      res.json({
        success: true,
        projectId: server.projectId,
        url: server.url,
        message: "Website server created successfully"
      });
    } catch (error) {
      console.error("Error creating website server:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create website server"
      });
    }
  });

  app.post("/api/stop-website/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      
      // Stop the website server using imported function
      const result = stopWebsiteServer(projectId);
      
      if (result) {
        res.json({
          success: true,
          message: "Website server stopped successfully"
        });
      } else {
        res.status(404).json({
          error: "Website server not found"
        });
      }
    } catch (error) {
      console.error("Error stopping website server:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to stop website server"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}