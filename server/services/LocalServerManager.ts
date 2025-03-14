// server/services/LocalServerManager.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import express from 'express';
import { createServer } from 'http';
import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';

// Import types for cors without importing the module directly
// This way TypeScript won't complain even if @types/cors isn't installed
const cors = require('cors');

const execAsync = promisify(exec);

interface LocalServer {
  port: number;
  serverProcess: ChildProcess | null;
  projectDir: string;
  serverUrl: string;
  isRunning: boolean;
  files: string[];
}

export class LocalServerManager {
  private static instance: LocalServerManager;
  private servers: Map<string, LocalServer> = new Map();
  private portCounter: number = 3100; // Start from port 3100 to avoid conflicts

  private constructor() {}

  public static getInstance(): LocalServerManager {
    if (!LocalServerManager.instance) {
      LocalServerManager.instance = new LocalServerManager();
    }
    return LocalServerManager.instance;
  }

  /**
   * Parses HTML content and extracts file paths from it
   */
  private extractFilesFromHtml(htmlContent: string): string[] {
    const files: string[] = [];
    
    // Extract links from a href attributes
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>/g;
    let match;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
      const href = match[1];
      if (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript:')) {
        files.push(href);
      }
    }
    
    // Extract script src attributes
    const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/g;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
      const src = match[1];
      if (!src.startsWith('http')) {
        files.push(src);
      }
    }
    
    // Extract link href attributes (CSS)
    const linkCssRegex = /<link[^>]*href=["']([^"']+)["'][^>]*>/g;
    while ((match = linkCssRegex.exec(htmlContent)) !== null) {
      const href = match[1];
      if (!href.startsWith('http') && href.endsWith('.css')) {
        files.push(href);
      }
    }
    
    // Extract img src attributes
    const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/g;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const src = match[1];
      if (!src.startsWith('http')) {
        files.push(src);
      }
    }
    
    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Creates a multi-page website from the provided code
   */
  public async createWebsite(code: string): Promise<{ serverId: string; serverUrl: string }> {
    try {
      const serverId = crypto.randomBytes(8).toString('hex');
      const projectDir = path.join(os.tmpdir(), `web-app-${serverId}`);
      
      // Create project directory
      await fs.mkdir(projectDir, { recursive: true });
      
      // Initialize with index.html
      let indexHtml = code;
      
      // Check if the code has file markers
      const fileHeaderRegex = /\/\/\s*[-]+\s*([a-zA-Z0-9_/.]+)\s*[-]+/g;
      const matches = [...code.matchAll(fileHeaderRegex)];
      
      if (matches.length > 0) {
        // The code contains multiple files
        console.log(`Found ${matches.length} files in the code`);
        const filePromises = [];
        
        // Process each file
        for (let i = 0; i < matches.length; i++) {
          const currentMatch = matches[i];
          const filePath = currentMatch[1].trim();
          const startPos = currentMatch.index! + currentMatch[0].length;
          const endPos = i < matches.length - 1 ? matches[i + 1].index! : code.length;
          const content = code.substring(startPos, endPos).trim();
          
          // Create the file path
          const fullPath = path.join(projectDir, filePath);
          const dirPath = path.dirname(fullPath);
          
          // Create directory if it doesn't exist
          await fs.mkdir(dirPath, { recursive: true });
          
          // Write file
          filePromises.push(fs.writeFile(fullPath, content));
          
          // Store index.html for reference
          if (filePath === 'index.html') {
            indexHtml = content;
          }
        }
        
        // Wait for all files to be written
        await Promise.all(filePromises);
      } else {
        // Single HTML file - write it as index.html
        await fs.writeFile(path.join(projectDir, 'index.html'), code);
      }
      
      // Extract linked files to check if we need to generate them
      const linkedFiles = this.extractFilesFromHtml(indexHtml);
      
      // Create any missing files (dummy content) to prevent 404 errors
      for (const file of linkedFiles) {
        const fullPath = path.join(projectDir, file);
        const dirPath = path.dirname(fullPath);
        
        try {
          // Check if file already exists
          await fs.access(fullPath);
        } catch (e) {
          // File doesn't exist, create it
          await fs.mkdir(dirPath, { recursive: true });
          
          // Create appropriate content based on file extension
          if (file.endsWith('.html')) {
            await fs.writeFile(fullPath, `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${path.basename(file)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <nav>
      <a href="index.html">Home</a>
      <a href="menu.html">Menu</a>
      <a href="cart.html">Cart</a>
      <a href="about.html">About</a>
    </nav>
  </header>
  <main>
    <h1>${path.basename(file, '.html').charAt(0).toUpperCase() + path.basename(file, '.html').slice(1)} Page</h1>
    <p>This is the ${path.basename(file, '.html')} page content.</p>
  </main>
  <footer>
    <p>&copy; 2025 Website Example</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>`);
          } else if (file.endsWith('.css')) {
            await fs.writeFile(fullPath, `
body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
  line-height: 1.6;
}

header {
  background-color: #333;
  color: white;
  padding: 1rem;
}

nav {
  display: flex;
  gap: 1rem;
}

nav a {
  color: white;
  text-decoration: none;
}

nav a:hover {
  text-decoration: underline;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

footer {
  text-align: center;
  padding: 1rem;
  background-color: #333;
  color: white;
}`);
          } else if (file.endsWith('.js')) {
            await fs.writeFile(fullPath, `
// Script for the website
console.log('Script loaded');

// Initialize cart from localStorage
let cart = JSON.parse(localStorage.getItem('cart')) || [];

// Update cart display
function updateCartDisplay() {
  const cartCount = document.getElementById('cart-count');
  if (cartCount) {
    cartCount.textContent = cart.reduce((total, item) => total + item.quantity, 0);
  }
}

// Add item to cart
function addToCart(id, name, price) {
  const existingItem = cart.find(item => item.id === id);
  
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({
      id,
      name,
      price,
      quantity: 1
    });
  }
  
  // Save to localStorage
  localStorage.setItem('cart', JSON.stringify(cart));
  
  // Update display
  updateCartDisplay();
  
  alert(\`\${name} added to cart\`);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  updateCartDisplay();
  
  // Initialize cart page if we're on it
  const cartItemsContainer = document.getElementById('cart-items');
  if (cartItemsContainer) {
    renderCartItems();
  }
});

// Render cart items on cart page
function renderCartItems() {
  const cartItemsContainer = document.getElementById('cart-items');
  if (!cartItemsContainer) return;
  
  cartItemsContainer.innerHTML = '';
  
  if (cart.length === 0) {
    cartItemsContainer.innerHTML = '<p>Your cart is empty</p>';
    return;
  }
  
  let total = 0;
  
  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    
    const cartItem = document.createElement('div');
    cartItem.className = 'cart-item';
    cartItem.innerHTML = \`
      <h3>\${item.name}</h3>
      <p>$\${item.price.toFixed(2)} x \${item.quantity} = $\${itemTotal.toFixed(2)}</p>
      <button onclick="removeItem(\${item.id})">Remove</button>
    \`;
    
    cartItemsContainer.appendChild(cartItem);
  });
  
  const totalElement = document.createElement('div');
  totalElement.className = 'cart-total';
  totalElement.innerHTML = \`<h3>Total: $\${total.toFixed(2)}</h3>\`;
  
  cartItemsContainer.appendChild(totalElement);
}

// Remove item from cart
function removeItem(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartDisplay();
  
  // Re-render cart items if on cart page
  const cartItemsContainer = document.getElementById('cart-items');
  if (cartItemsContainer) {
    renderCartItems();
  }
}`);
          } else if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.gif')) {
            // Create a small placeholder image (1x1 transparent pixel base64)
            const transparentPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
            await fs.writeFile(fullPath, transparentPixel);
          } else {
            // For any other file type, create an empty file
            await fs.writeFile(fullPath, '');
          }
        }
      }
      
      // Set up a port for the server
      const port = this.portCounter++;
      
      // Create an Express server to serve the files
      const app = express();
      const server = createServer(app);
      
      // Add CORS and middleware
      app.use(cors());
      app.use(express.static(projectDir));
      
      // Add a route for index.html
      app.get('/', (req, res) => {
        res.sendFile(path.join(projectDir, 'index.html'));
      });
      
      // Start the server
      server.listen(port, '127.0.0.1', () => {
        console.log(`Local server started on http://localhost:${port}`);
      });
      
      // Store server instance
      this.servers.set(serverId, {
        port,
        serverProcess: null, // We're not using a separate process
        projectDir,
        serverUrl: `http://localhost:${port}`,
        isRunning: true,
        files: linkedFiles
      });
      
      return {
        serverId,
        serverUrl: `http://localhost:${port}`
      };
    } catch (error) {
      console.error('Error creating local server:', error);
      throw error;
    }
  }

  /**
   * Stops a running server
   */
  public async stopServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) {
      return false;
    }
    
    try {
      // If there's a server process, kill it
      if (server.serverProcess) {
        server.serverProcess.kill();
      }
      
      server.isRunning = false;
      return true;
    } catch (error) {
      console.error(`Error stopping server ${serverId}:`, error);
      return false;
    }
  }

  /**
   * Cleans up server files and resources
   */
  public async cleanupServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) {
      return false;
    }
    
    try {
      // Stop the server if it's running
      await this.stopServer(serverId);
      
      // Remove project directory
      await fs.rm(server.projectDir, { recursive: true, force: true });
      
      // Remove from servers map
      this.servers.delete(serverId);
      
      return true;
    } catch (error) {
      console.error(`Error cleaning up server ${serverId}:`, error);
      return false;
    }
  }

  /**
   * Get server status
   */
  public getServerStatus(serverId: string): {
    isRunning: boolean;
    serverUrl: string;
    files: string[];
  } | null {
    const server = this.servers.get(serverId);
    if (!server) {
      return null;
    }
    
    return {
      isRunning: server.isRunning,
      serverUrl: server.serverUrl,
      files: server.files
    };
  }

  /**
   * Clean up all servers (for shutdown)
   */
  public async cleanupAllServers(): Promise<void> {
    const promises: Promise<boolean>[] = [];
    
    for (const serverId of this.servers.keys()) {
      promises.push(this.cleanupServer(serverId));
    }
    
    await Promise.all(promises);
  }
}