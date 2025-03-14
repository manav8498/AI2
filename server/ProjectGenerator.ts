// server/ProjectGenerator.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ProjectFile {
  path: string;
  content: string;
}

// Main class for managing fullstack project generation
export class ProjectGenerator {
  private projectDir: string;
  private frontendDir: string;
  private backendDir: string;
  private projectId: string;
  private backendServer: ChildProcess | null = null;
  private frontendServer: ChildProcess | null = null;
  private backendPort: number = 3001;
  private frontendPort: number = 3002;

  constructor() {
    this.projectId = crypto.randomBytes(4).toString('hex');
    this.projectDir = path.join(os.tmpdir(), `fullstack-${this.projectId}`);
    this.frontendDir = path.join(this.projectDir, 'frontend');
    this.backendDir = path.join(this.projectDir, 'backend');
  }

  // Initialize project directories
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.projectDir, { recursive: true });
      await fs.mkdir(this.frontendDir, { recursive: true });
      await fs.mkdir(this.backendDir, { recursive: true });
      console.log(`Created project directory: ${this.projectDir}`);
    } catch (error) {
      console.error('Error initializing project directories:', error);
      throw error;
    }
  }

  // Parse generated code and separate frontend from backend
  async parseAndSeparateCode(generatedCode: string): Promise<{ 
    frontendFiles: ProjectFile[],
    backendFiles: ProjectFile[],
    projectStructure: string
  }> {
    console.log("Parsing and separating code...");
    
    // First, let's check if the code contains file headers/separators
    const fileHeaderRegex = /\/\/\s*[-]+\s*([a-zA-Z0-9_/.]+)\s*[-]+/g;
    const matches = [...generatedCode.matchAll(fileHeaderRegex)];
    
    let frontendFiles: ProjectFile[] = [];
    let backendFiles: ProjectFile[] = [];
    let projectStructure = "Project Structure:\n";
    
    if (matches.length > 0) {
      // Code is already organized into files
      for (let i = 0; i < matches.length; i++) {
        const currentMatch = matches[i];
        const filePath = currentMatch[1].trim();
        const startPos = currentMatch.index! + currentMatch[0].length;
        const endPos = i < matches.length - 1 ? matches[i + 1].index! : generatedCode.length;
        let content = generatedCode.substring(startPos, endPos).trim();
        
        // Determine if frontend or backend based on path
        if (filePath.startsWith('frontend/') || 
            filePath.includes('public/') ||
            filePath.includes('src/') && !filePath.includes('server/') ||
            filePath.endsWith('.html') ||
            filePath.endsWith('.css') ||
            filePath.endsWith('.jsx') ||
            filePath.endsWith('.tsx')) {
          
          const normalizedPath = filePath.startsWith('frontend/') 
            ? filePath.substring(9) // Remove 'frontend/' prefix
            : filePath;
            
          frontendFiles.push({
            path: normalizedPath,
            content
          });
          projectStructure += `- Frontend: ${normalizedPath}\n`;
        } else if (filePath.startsWith('backend/') || 
                  filePath.includes('server/') ||
                  filePath.endsWith('.js') ||
                  filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) {
          
          const normalizedPath = filePath.startsWith('backend/') 
            ? filePath.substring(8) // Remove 'backend/' prefix
            : filePath;
            
          backendFiles.push({
            path: normalizedPath,
            content
          });
          projectStructure += `- Backend: ${normalizedPath}\n`;
        } else {
          // If ambiguous, check content to determine
          if (content.includes('express') || 
              content.includes('app.listen') ||
              content.includes('router') ||
              content.includes('module.exports') ||
              content.includes('export default function')) {
            backendFiles.push({
              path: filePath,
              content
            });
            projectStructure += `- Backend: ${filePath}\n`;
          } else {
            frontendFiles.push({
              path: filePath,
              content
            });
            projectStructure += `- Frontend: ${filePath}\n`;
          }
        }
      }
    } else {
      // No file structure found, try to identify frontend/backend by content analysis
      console.log("No file structure found, analyzing content...");
      
      // Split by markdown code blocks if present
      const markdownRegex = /```([a-z]*)\n([\s\S]*?)```/g;
      const markdownMatches = [...generatedCode.matchAll(markdownRegex)];
      
      if (markdownMatches.length > 0) {
        for (const match of markdownMatches) {
          const language = match[1].trim();
          const content = match[2].trim();
          
          if (language === 'html' || language === 'jsx' || language === 'tsx') {
            frontendFiles.push({
              path: language === 'html' ? 'index.html' : `App.${language}`,
              content
            });
            projectStructure += `- Frontend: ${language === 'html' ? 'index.html' : `App.${language}`}\n`;
          } else if (language === 'css') {
            frontendFiles.push({
              path: 'styles.css',
              content
            });
            projectStructure += `- Frontend: styles.css\n`;
          } else if (language === 'js' || language === 'javascript') {
            // Analyze if it's frontend or backend JS
            if (content.includes('document') || 
                content.includes('window') || 
                content.includes('addEventListener')) {
              frontendFiles.push({
                path: 'script.js',
                content
              });
              projectStructure += `- Frontend: script.js\n`;
            } else if (content.includes('express') || 
                      content.includes('http.createServer') || 
                      content.includes('app.listen')) {
              backendFiles.push({
                path: 'server.js',
                content
              });
              projectStructure += `- Backend: server.js\n`;
            } else {
              // If ambiguous, put in frontend
              frontendFiles.push({
                path: 'script.js',
                content
              });
              projectStructure += `- Frontend: script.js\n`;
            }
          } else {
            // Assume any other language blocks are backend
            backendFiles.push({
              path: `index.${language || 'js'}`,
              content
            });
            projectStructure += `- Backend: index.${language || 'js'}\n`;
          }
        }
      } else {
        // No markdown either, try heuristic based split
        if (generatedCode.includes('<html') || generatedCode.includes('<!DOCTYPE')) {
          // HTML content, extract it
          const htmlMatch = /<html[\s\S]*?<\/html>/i.exec(generatedCode);
          if (htmlMatch) {
            frontendFiles.push({
              path: 'index.html',
              content: htmlMatch[0]
            });
            projectStructure += `- Frontend: index.html\n`;
            
            // Remove HTML to analyze the rest
            generatedCode = generatedCode.replace(htmlMatch[0], '');
          }
        }
        
        // Check for CSS
        const cssMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(generatedCode);
        if (cssMatch) {
          frontendFiles.push({
            path: 'styles.css',
            content: cssMatch[1]
          });
          projectStructure += `- Frontend: styles.css\n`;
          
          // Remove CSS to analyze the rest
          generatedCode = generatedCode.replace(cssMatch[0], '');
        }
        
        // Check for client-side JS
        const clientJsMatch = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(generatedCode);
        if (clientJsMatch) {
          frontendFiles.push({
            path: 'script.js',
            content: clientJsMatch[1]
          });
          projectStructure += `- Frontend: script.js\n`;
          
          // Remove client JS to analyze the rest
          generatedCode = generatedCode.replace(clientJsMatch[0], '');
        }
        
        // If there's remaining code, assume it's server code
        if (generatedCode.trim()) {
          backendFiles.push({
            path: 'server.js',
            content: generatedCode.trim()
          });
          projectStructure += `- Backend: server.js\n`;
        }
        
        // If we don't have either frontend or backend files yet, create defaults
        if (frontendFiles.length === 0) {
          frontendFiles.push({
            path: 'index.html',
            content: '<html><body><h1>Frontend</h1><p>Connect to backend API</p></body></html>'
          });
          projectStructure += `- Frontend: index.html (default)\n`;
        }
        
        if (backendFiles.length === 0) {
          backendFiles.push({
            path: 'server.js',
            content: `
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api', (req, res) => {
  res.json({ message: 'API is working!' });
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});`
          });
          projectStructure += `- Backend: server.js (default)\n`;
        }
      }
    }
    
    return { frontendFiles, backendFiles, projectStructure };
  }

  // Write files to their respective directories
  async writeProjectFiles(frontendFiles: ProjectFile[], backendFiles: ProjectFile[]): Promise<void> {
    console.log("Writing project files...");
    
    const writeFile = async (basePath: string, file: ProjectFile) => {
      const filePath = path.join(basePath, file.path);
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, file.content);
      console.log(`Created file: ${filePath}`);
    };
    
    // Write frontend files
    for (const file of frontendFiles) {
      await writeFile(this.frontendDir, file);
    }
    
    // Write backend files
    for (const file of backendFiles) {
      await writeFile(this.backendDir, file);
    }
    
    // Create package.json files if they don't exist
    if (!backendFiles.some(f => f.path === 'package.json')) {
      await this.createBackendPackageJson();
    }
    
    if (!frontendFiles.some(f => f.path === 'package.json')) {
      await this.createFrontendPackageJson();
    }
  }

  // Create default package.json for backend if needed
  private async createBackendPackageJson(): Promise<void> {
    const packageJson = {
      "name": "backend",
      "version": "1.0.0",
      "description": "Generated backend",
      "main": "server.js",
      "scripts": {
        "start": "node server.js"
      },
      "dependencies": {
        "express": "^4.18.2",
        "cors": "^2.8.5",
        "body-parser": "^1.20.1"
      }
    };
    
    await fs.writeFile(
      path.join(this.backendDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    console.log("Created default backend package.json");
  }

  // Create default package.json for frontend if needed
  private async createFrontendPackageJson(): Promise<void> {
    const packageJson = {
      "name": "frontend",
      "version": "1.0.0",
      "description": "Generated frontend",
      "scripts": {
        "start": "serve -s ."
      },
      "dependencies": {
        "serve": "^14.2.0"
      }
    };
    
    await fs.writeFile(
      path.join(this.frontendDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    console.log("Created default frontend package.json");
  }

  // Install dependencies for both projects
  async installDependencies(): Promise<void> {
    console.log("Installing dependencies...");
    
    try {
      // Install backend dependencies
      console.log("Installing backend dependencies...");
      await execAsync(`cd ${this.backendDir} && npm install`);
      
      // Install frontend dependencies
      console.log("Installing frontend dependencies...");
      await execAsync(`cd ${this.frontendDir} && npm install`);
      
      console.log("Dependencies installed successfully");
    } catch (error) {
      console.error("Error installing dependencies:", error);
      throw error;
    }
  }

  // Start the backend server
  async startBackendServer(): Promise<number> {
    console.log("Starting backend server...");
    
    // Find the main backend file
    let mainFile = 'server.js';
    try {
      const files = await fs.readdir(this.backendDir);
      if (files.includes('app.js')) {
        mainFile = 'app.js';
      } else if (files.includes('index.js')) {
        mainFile = 'index.js';
      }
    } catch (error) {
      console.error("Error finding main backend file:", error);
    }
    
    // Kill existing server if running
    this.stopBackendServer();
    
    // Set env variables for the port
    const env = {
      ...process.env,
      PORT: this.backendPort.toString()
    };
    
    // Start the backend server
    this.backendServer = spawn('node', [mainFile], {
      cwd: this.backendDir,
      env,
      stdio: 'pipe'
    });
    
    console.log(`Backend server started on port ${this.backendPort}`);
    
    // Log output
    this.backendServer.stdout?.on('data', (data) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });
    
    this.backendServer.stderr?.on('data', (data) => {
      console.error(`[Backend Error] ${data.toString().trim()}`);
    });
    
    return this.backendPort;
  }

  // Start the frontend server
  async startFrontendServer(): Promise<number> {
    console.log("Starting frontend server...");
    
    // Kill existing server if running
    this.stopFrontendServer();
    
    // Check if index.html exists or if it's a more complex frontend
    const files = await fs.readdir(this.frontendDir);
    const hasPackageJson = files.includes('package.json');
    const hasIndexHtml = files.includes('index.html');
    
    if (hasIndexHtml) {
      // Use serve for static files
      this.frontendServer = spawn('npx', ['serve', '-s', '.', '-p', this.frontendPort.toString()], {
        cwd: this.frontendDir,
        stdio: 'pipe'
      });
    } else if (hasPackageJson) {
      // Try to use npm start
      this.frontendServer = spawn('npm', ['start'], {
        cwd: this.frontendDir,
        env: {
          ...process.env,
          PORT: this.frontendPort.toString()
        },
        stdio: 'pipe'
      });
    } else {
      // Fallback to serve
      this.frontendServer = spawn('npx', ['serve', '.', '-p', this.frontendPort.toString()], {
        cwd: this.frontendDir,
        stdio: 'pipe'
      });
    }
    
    console.log(`Frontend server started on port ${this.frontendPort}`);
    
    // Log output
    this.frontendServer.stdout?.on('data', (data) => {
      console.log(`[Frontend] ${data.toString().trim()}`);
    });
    
    this.frontendServer.stderr?.on('data', (data) => {
      console.error(`[Frontend Error] ${data.toString().trim()}`);
    });
    
    return this.frontendPort;
  }

  // Stop the backend server
  stopBackendServer(): void {
    if (this.backendServer) {
      this.backendServer.kill();
      this.backendServer = null;
      console.log("Backend server stopped");
    }
  }

  // Stop the frontend server
  stopFrontendServer(): void {
    if (this.frontendServer) {
      this.frontendServer.kill();
      this.frontendServer = null;
      console.log("Frontend server stopped");
    }
  }

  // Stop all servers
  stopAll(): void {
    this.stopBackendServer();
    this.stopFrontendServer();
  }

  // Set ports for the servers
  setPorts(frontendPort: number, backendPort: number): void {
    this.frontendPort = frontendPort;
    this.backendPort = backendPort;
  }

  // Clean up project files
  async cleanup(): Promise<void> {
    this.stopAll();
    
    try {
      await fs.rm(this.projectDir, { recursive: true, force: true });
      console.log(`Cleaned up project directory: ${this.projectDir}`);
    } catch (error) {
      console.error("Error cleaning up project directory:", error);
    }
  }

  // Get project info
  getProjectInfo(): {
    projectDir: string;
    frontendDir: string;
    backendDir: string;
    frontendPort: number;
    backendPort: number;
  } {
    return {
      projectDir: this.projectDir,
      frontendDir: this.frontendDir,
      backendDir: this.backendDir,
      frontendPort: this.frontendPort,
      backendPort: this.backendPort
    };
  }
}