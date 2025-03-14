// server/services/WebsiteServer.ts
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import cors from 'cors';
import { createServer, Server } from 'http';
import { fileURLToPath } from 'url';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interface for server info
interface ServerInfo {
  server: Server;
  port: number;
  directory: string;
  url: string;
}

// Interface for returned server details
interface ServerDetails {
  projectId: string;
  url: string;
  port: number;
  directory: string;
}

// Map to store active servers
const activeServers = new Map<string, ServerInfo>();
let nextPort = 3500; // Start port for servers

/**
 * Creates a static website server from HTML content
 * @param {string} html - The HTML content of the main page
 * @returns {ServerDetails} Server information including URL
 */
export function createWebsiteServer(html: string): ServerDetails {
  // Create a unique project directory
  const projectId = Date.now().toString();
  const projectDir = path.join(__dirname, '../../temp', projectId);
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  
  // Write the main HTML file
  fs.writeFileSync(path.join(projectDir, 'index.html'), html);
  
  // Parse the HTML for links to other pages
  const fileLinks = extractFileLinks(html);
  
  // Create empty files for all linked pages to prevent 404 errors
  fileLinks.forEach(file => {
    const filePath = path.join(projectDir, file);
    const dirPath = path.dirname(filePath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Create the file if it doesn't exist
    if (!fs.existsSync(filePath)) {
      // Default content based on file type
      let content = '';
      if (file.endsWith('.html')) {
        content = createDefaultHtml(file);
      } else if (file.endsWith('.css')) {
        content = createDefaultCss();
      } else if (file.endsWith('.js')) {
        content = createDefaultJs();
      }
      fs.writeFileSync(filePath, content);
    }
  });
  
  // Create a default JavaScript file for localStorage functionality
  fs.writeFileSync(path.join(projectDir, 'script.js'), createDefaultJs());
  
  // Create a default CSS file
  fs.writeFileSync(path.join(projectDir, 'styles.css'), createDefaultCss());
  
  // Start the server
  const port = nextPort++;
  const app = express();
  
  // Add CORS middleware
  app.use(cors());
  
  // Serve static files
  app.use(express.static(projectDir));
  
  // Handle routes for HTML files to serve the file directly
  app.get('/:page', (req, res) => {
    const page = req.params.page;
    
    // If file exists, serve it
    const filePath = path.join(projectDir, page);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else if (fs.existsSync(filePath + '.html')) {
      // Try with .html extension
      res.sendFile(filePath + '.html');
    } else {
      // Redirect to index if file not found
      res.redirect('/');
    }
  });
  
  // Default route sends index.html
  app.get('/', (req, res) => {
    res.sendFile(path.join(projectDir, 'index.html'));
  });
  
  // Create and start the server
  const server = createServer(app);
  server.listen(port, () => {
    console.log(`Website server running at http://localhost:${port}`);
  });
  
  // Store server info
  activeServers.set(projectId, {
    server,
    port,
    directory: projectDir,
    url: `http://localhost:${port}`
  });
  
  return {
    projectId,
    url: `http://localhost:${port}`,
    port,
    directory: projectDir
  };
}

/**
 * Stops a running website server
 * @param {string} projectId - The ID of the project to stop
 * @returns {boolean} Success status
 */
export function stopWebsiteServer(projectId: string): boolean {
  if (!activeServers.has(projectId)) {
    return false;
  }
  
  const { server, directory } = activeServers.get(projectId)!;
  
  // Close the server
  server.close();
  
  // Clean up directory
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.error('Error removing directory:', error);
  }
  
  // Remove from active servers
  activeServers.delete(projectId);
  
  return true;
}

/**
 * Extract file links from HTML content
 * @param {string} html - The HTML content to parse
 * @returns {string[]} List of file paths
 */
function extractFileLinks(html: string): string[] {
  const links = new Set<string>();
  
  // Extract href links
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // Skip external links, anchors and javascript
    if (!href.startsWith('http') && 
        !href.startsWith('#') && 
        !href.startsWith('javascript:') &&
        !href.includes('://')) {
      links.add(href);
    }
  }
  
  // Extract src links
  const srcRegex = /src=["']([^"']+)["']/g;
  while ((match = srcRegex.exec(html)) !== null) {
    const src = match[1];
    if (!src.startsWith('http') && !src.includes('://')) {
      links.add(src);
    }
  }
  
  // Create standard files that might be needed
  const standardFiles = ['menu.html', 'cart.html', 'about.html', 'contact.html', 'products.html'];
  standardFiles.forEach(file => links.add(file));
  
  return Array.from(links);
}

/**
 * Create default HTML for a page
 * @param {string} filename - The name of the file
 * @returns {string} HTML content
 */
function createDefaultHtml(filename: string): string {
  const pageName = path.basename(filename, '.html').charAt(0).toUpperCase() + 
                   path.basename(filename, '.html').slice(1);
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageName} - Sweet Delights Bakery</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <div class="logo">Sweet Delights</div>
    <nav>
      <a href="/index.html">Home</a>
      <a href="/menu.html">Menu</a>
      <a href="/cart.html">Cart <span id="cart-count">0</span></a>
      <a href="/about.html">About</a>
    </nav>
  </header>
  
  <main>
    <h1>${pageName} Page</h1>
    <p>Welcome to the ${pageName} page of Sweet Delights Bakery.</p>
    
    <div class="content">
      <!-- Content will be here -->
      <p>This is an automatically generated page.</p>
    </div>
  </main>
  
  <footer>
    <p>&copy; 2025 Sweet Delights Bakery. All rights reserved.</p>
  </footer>
  
  <script src="/script.js"></script>
</body>
</html>
  `;
}

/**
 * Create default CSS content
 * @returns {string} CSS content
 */
function createDefaultCss(): string {
  return `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: Arial, sans-serif;
  line-height: 1.6;
  color: #333;
}

header {
  background-color: #ff8c42;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-size: 1.5rem;
  font-weight: bold;
  color: #fff;
}

nav {
  display: flex;
  gap: 1rem;
}

nav a {
  color: #fff;
  text-decoration: none;
  padding: 0.5rem;
}

nav a:hover {
  text-decoration: underline;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

h1 {
  color: #ff8c42;
  margin-bottom: 1rem;
}

.content {
  margin-top: 2rem;
}

footer {
  background-color: #333;
  color: #fff;
  text-align: center;
  padding: 1rem;
  margin-top: 2rem;
}

/* Cart styles */
.cart-item {
  border-bottom: 1px solid #ddd;
  padding: 1rem 0;
  display: flex;
  justify-content: space-between;
}

.cart-total {
  margin-top: 2rem;
  text-align: right;
  font-weight: bold;
}
  `;
}

/**
 * Create default JavaScript with localStorage functionality
 * @returns {string} JavaScript content
 */
function createDefaultJs(): string {
  return `
// Initialize cart from localStorage
let cart = JSON.parse(localStorage.getItem('cart')) || [];

// Update cart count on page load
document.addEventListener('DOMContentLoaded', function() {
  updateCartDisplay();
  
  // Check if we're on the cart page
  const cartItems = document.getElementById('cart-items');
  if (cartItems) {
    renderCartItems();
  }
});

// Update cart display
function updateCartDisplay() {
  const cartCount = document.getElementById('cart-count');
  if (cartCount) {
    cartCount.textContent = cart.reduce((total, item) => total + item.quantity, 0);
  }
}

// Add item to cart
function addToCart(id, name, price) {
  // Check if item already exists
  const existingItem = cart.find(item => item.id === id);
  
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({
      id: id,
      name: name,
      price: price,
      quantity: 1
    });
  }
  
  // Save to localStorage
  localStorage.setItem('cart', JSON.stringify(cart));
  
  // Update display
  updateCartDisplay();
  
  alert(\`\${name} added to cart!\`);
}

// Render cart items on cart page
function renderCartItems() {
  const cartItems = document.getElementById('cart-items');
  if (!cartItems) return;
  
  // Clear existing items
  cartItems.innerHTML = '';
  
  if (cart.length === 0) {
    cartItems.innerHTML = '<p>Your cart is empty</p>';
    return;
  }
  
  // Calculate total
  let total = 0;
  
  // Add each item
  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    
    const cartItem = document.createElement('div');
    cartItem.className = 'cart-item';
    cartItem.innerHTML = \`
      <div>
        <h3>\${item.name}</h3>
        <p>Quantity: \${item.quantity}</p>
      </div>
      <div>
        <p>$\${item.price.toFixed(2)} each</p>
        <p><strong>$\${itemTotal.toFixed(2)}</strong></p>
        <button onclick="removeFromCart(\${item.id})">Remove</button>
      </div>
    \`;
    
    cartItems.appendChild(cartItem);
  });
  
  // Add total
  const totalElement = document.createElement('div');
  totalElement.className = 'cart-total';
  totalElement.innerHTML = \`<h2>Total: $\${total.toFixed(2)}</h2>\`;
  cartItems.appendChild(totalElement);
}

// Remove item from cart
function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartDisplay();
  
  // Re-render if on cart page
  const cartItems = document.getElementById('cart-items');
  if (cartItems) {
    renderCartItems();
  }
}
  `;
}