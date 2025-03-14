// server/services/ProjectManager.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectRuntime {
  frontendPort: number;
  backendPort: number;
  frontendUrl: string;
  backendUrl: string;
  projectId: string;
  projectType: string;
  logs: string[];
}

// Project templates for different frameworks
const PROJECT_TEMPLATES = {
  // Common package.json templates
  PACKAGE_JSON: {
    REACT: {
      name: "react-app",
      version: "1.0.0",
      private: true,
      dependencies: {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.8.1", 
        "react-scripts": "5.0.1"
      },
      scripts: {
        "start": "react-scripts start",
        "build": "react-scripts build",
        "test": "react-scripts test",
        "eject": "react-scripts eject"
      },
      browserslist: {
        "production": [
          ">0.2%",
          "not dead",
          "not op_mini all"
        ],
        "development": [
          "last 1 chrome version",
          "last 1 firefox version",
          "last 1 safari version"
        ]
      }
    },
    EXPRESS: {
      name: "express-api",
      version: "1.0.0",
      main: "server.js",
      scripts: {
        "start": "node server.js",
        "dev": "nodemon server.js"
      },
      dependencies: {
        "express": "^4.18.2",
        "cors": "^2.8.5",
        "body-parser": "^1.20.2",
        "dotenv": "^16.0.3"
      },
      devDependencies: {
        "nodemon": "^2.0.22"
      }
    },
    VUE: {
      name: "vue-app",
      version: "1.0.0",
      private: true,
      scripts: {
        "serve": "vue-cli-service serve",
        "build": "vue-cli-service build"
      },
      dependencies: {
        "core-js": "^3.29.0",
        "vue": "^3.2.47",
        "vue-router": "^4.1.6"
      },
      devDependencies: {
        "@vue/cli-plugin-babel": "~5.0.8",
        "@vue/cli-service": "~5.0.8"
      }
    }
  }
};

export class ProjectManager {
  private static instance: ProjectManager;
  private projects: Map<string, {
    projectDir: string;
    projectType: string; // react, express, vue, static, etc.
    frontendPort: number;
    backendPort: number;
    frontendServer?: ChildProcess;
    backendServer?: ChildProcess;
    logs: string[];
    isFullstack: boolean;
  }> = new Map();

  private constructor() {}

  public static getInstance(): ProjectManager {
    if (!ProjectManager.instance) {
      ProjectManager.instance = new ProjectManager();
    }
    return ProjectManager.instance;
  }

  // Detect project type from code and files
  private detectProjectType(files: ProjectFile[]): {
    projectType: string;
    isFullstack: boolean;
  } {
    // Check for framework-specific patterns
    const hasReact = files.some(file => 
      file.content.includes('import React') || 
      file.content.includes('from "react"') ||
      file.content.includes('from \'react\'')
    );
    
    const hasVue = files.some(file => 
      file.content.includes('<template>') || 
      file.content.includes('createApp') ||
      file.content.includes('from "vue"') ||
      file.content.includes('from \'vue\'')
    );
    
    const hasExpress = files.some(file => 
      file.content.includes('express()') || 
      file.content.includes('require(\'express\')') ||
      file.content.includes('require("express")')
    );
    
    const hasAngular = files.some(file => 
      file.content.includes('@angular') || 
      file.content.includes('platformBrowserDynamic')
    );
    
    const hasBackend = hasExpress || files.some(file => 
      file.content.includes('app.listen') || 
      file.content.includes('createServer') ||
      file.path.includes('server.js') ||
      file.path.includes('app.js')
    );
    
    const hasFrontend = files.some(file => 
      file.path.endsWith('.html') || 
      file.path.includes('index.html')
    );
    
    // Determine the primary project type
    let projectType = 'static';
    if (hasReact) {
      projectType = 'react';
    } else if (hasVue) {
      projectType = 'vue';
    } else if (hasAngular) {
      projectType = 'angular';
    } else if (hasExpress && !hasFrontend) {
      projectType = 'express';
    }
    
    // Check if this is a fullstack application
    const isFullstack = hasBackend && hasFrontend;
    
    return { projectType, isFullstack };
  }

  // Extract file structure from generated code
  public parseProjectStructure(code: string): ProjectFile[] {
    const files: ProjectFile[] = [];
    const fileHeaderRegex = /\/\/\s*[-]+\s*([a-zA-Z0-9_/.]+)\s*[-]+/g;
    let match;
    let lastIndex = 0;
    const matches = [];

    // Find all file headers
    while ((match = fileHeaderRegex.exec(code)) !== null) {
      matches.push({ header: match[0], path: match[1], index: match.index });
      lastIndex = fileHeaderRegex.lastIndex;
    }

    // Extract file content between headers
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const startPos = currentMatch.index + currentMatch.header.length;
      const endPos = i < matches.length - 1 ? matches[i + 1].index : code.length;
      const content = code.substring(startPos, endPos).trim();
      
      files.push({
        path: currentMatch.path.trim(),
        content
      });
    }

    // If no file structure was found, try alternative extraction methods
    if (files.length === 0) {
      const extractedFiles = this.extractFilesFromCode(code);
      files.push(...extractedFiles);
    }

    // Apply necessary fixes to files for proper routing
    this.fixFilesForProperRouting(files);

    return files;
  }

  // Extract files from code using alternative methods
  private extractFilesFromCode(code: string): ProjectFile[] {
    const files: ProjectFile[] = [];
    
    // Try to detect if code has markdown code blocks
    const markdownBlockRegex = /```([a-z]*)\s+([^`]+)```/g;
    let markdownMatch;
    
    if (code.includes('```')) {
      const markdownMatches = [];
      
      while ((markdownMatch = markdownBlockRegex.exec(code)) !== null) {
        const language = markdownMatch[1].trim();
        const content = markdownMatch[2].trim();
        
        let filePath = '';
        
        // Determine appropriate file path based on language
        if (language === 'html') {
          filePath = 'frontend/index.html';
        } else if (language === 'css') {
          filePath = 'frontend/styles.css';
        } else if (language === 'js' || language === 'javascript') {
          // Try to detect if this is frontend or backend JavaScript
          if (content.includes('express') || content.includes('app.listen')) {
            filePath = 'backend/server.js';
          } else if (content.includes('document') || content.includes('window')) {
            filePath = 'frontend/script.js';
          } else {
            filePath = 'frontend/script.js'; // Default to frontend
          }
        } else if (language === 'jsx' || language === 'tsx') {
          filePath = `frontend/App.${language}`;
        } else if (language === 'json') {
          if (content.includes('"dependencies"') && content.includes('"express"')) {
            filePath = 'backend/package.json';
          } else if (content.includes('"dependencies"') && (content.includes('"react"') || content.includes('"vue"'))) {
            filePath = 'frontend/package.json';
          } else {
            filePath = 'package.json';
          }
        } else if (language) {
          // Use the language as extension for other file types
          filePath = `${language === 'python' ? 'backend' : 'frontend'}/index.${language}`;
        }
        
        if (filePath) {
          files.push({
            path: filePath,
            content
          });
        }
      }
    }
    
    // If no markdown blocks or no valid files found, try to extract HTML/CSS/JS directly
    if (files.length === 0) {
      this.createDefaultStructure(code, files);
    }
    
    return files;
  }

  // Create a default structure if none is provided by the LLM
  private createDefaultStructure(code: string, files: ProjectFile[]): void {
    // Check if the code contains HTML
    if (code.includes('<html') || code.includes('<!DOCTYPE')) {
      // Extract HTML content
      const htmlContent = this.extractHtmlContent(code);
      if (htmlContent) {
        files.push({
          path: 'frontend/index.html',
          content: htmlContent
        });
        
        // Look for CSS in style tags
        const cssContent = this.extractCssContent(code);
        if (cssContent) {
          files.push({
            path: 'frontend/styles.css',
            content: cssContent
          });
        }
        
        // Look for JS in script tags
        const jsContent = this.extractJsContent(code);
        if (jsContent) {
          files.push({
            path: 'frontend/script.js',
            content: jsContent
          });
        }
      }
    }
    
    // Check for server code
    if (code.includes('express') || code.includes('app.listen') || code.includes('http.createServer')) {
      // Assume remaining code is backend
      const serverContent = code.replace(/<html[\s\S]*?<\/html>/i, '')
                               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                               .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                               .trim();
      
      if (serverContent) {
        files.push({
          path: 'backend/server.js',
          content: serverContent
        });
      }
    }
    
    // Create default package.json files if needed
    if (!files.some(f => f.path === 'backend/package.json')) {
      files.push({
        path: 'backend/package.json',
        content: JSON.stringify(PROJECT_TEMPLATES.PACKAGE_JSON.EXPRESS, null, 2)
      });
    }
    
    // If we still don't have either frontend or backend files, create defaults
    if (!files.some(f => f.path.startsWith('frontend/'))) {
      files.push({
        path: 'frontend/index.html',
        content: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Application</title>
  <link rel="stylesheet" href="styles.css">
  <script src="script.js" defer></script>
</head>
<body>
  <header>
    <nav>
      <h1>Web Application</h1>
      <ul>
        <li><a href="index.html">Home</a></li>
        <li><a href="menu.html">Menu</a></li>
        <li><a href="cart.html">Cart (0)</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <section id="home">
      <h2>Welcome to our application</h2>
      <p>This is the home page of the application.</p>
    </section>
  </main>
  <footer>
    <p>&copy; 2023 Web Application</p>
  </footer>
</body>
</html>`
      });
      
      files.push({
        path: 'frontend/menu.html',
        content: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Menu - Web Application</title>
  <link rel="stylesheet" href="styles.css">
  <script src="script.js" defer></script>
</head>
<body>
  <header>
    <nav>
      <h1>Web Application</h1>
      <ul>
        <li><a href="index.html">Home</a></li>
        <li><a href="menu.html" class="active">Menu</a></li>
        <li><a href="cart.html">Cart (<span id="cart-count">0</span>)</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <section id="menu">
      <h2>Menu</h2>
      <div class="menu-grid">
        <div class="menu-item">
          <h3>Item 1</h3>
          <p>Description of item 1</p>
          <p class="price">$10.99</p>
          <button onclick="addToCart(1, 'Item 1', 10.99)">Add to Cart</button>
        </div>
        <div class="menu-item">
          <h3>Item 2</h3>
          <p>Description of item 2</p>
          <p class="price">$12.99</p>
          <button onclick="addToCart(2, 'Item 2', 12.99)">Add to Cart</button>
        </div>
        <div class="menu-item">
          <h3>Item 3</h3>
          <p>Description of item 3</p>
          <p class="price">$9.99</p>
          <button onclick="addToCart(3, 'Item 3', 9.99)">Add to Cart</button>
        </div>
      </div>
    </section>
  </main>
  <footer>
    <p>&copy; 2023 Web Application</p>
  </footer>
</body>
</html>`
      });
      
      files.push({
        path: 'frontend/cart.html',
        content: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cart - Web Application</title>
  <link rel="stylesheet" href="styles.css">
  <script src="script.js" defer></script>
</head>
<body>
  <header>
    <nav>
      <h1>Web Application</h1>
      <ul>
        <li><a href="index.html">Home</a></li>
        <li><a href="menu.html">Menu</a></li>
        <li><a href="cart.html" class="active">Cart (<span id="cart-count">0</span>)</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <section id="cart">
      <h2>Shopping Cart</h2>
      <div id="cart-items">
        <!-- Cart items will be displayed here -->
        <p id="empty-cart">Your cart is empty.</p>
      </div>
      <div id="cart-summary" style="display: none;">
        <p>Total: $<span id="cart-total">0.00</span></p>
        <button id="checkout-button">Checkout</button>
      </div>
    </section>
  </main>
  <footer>
    <p>&copy; 2023 Web Application</p>
  </footer>
</body>
</html>`
      });
      
      files.push({
        path: 'frontend/styles.css',
        content: `
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
  justify-content: space-between;
  align-items: center;
}

nav ul {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
}

nav ul li {
  margin-left: 1rem;
}

nav a {
  color: white;
  text-decoration: none;
}

nav a.active {
  font-weight: bold;
  text-decoration: underline;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

footer {
  background-color: #333;
  color: white;
  text-align: center;
  padding: 1rem;
  margin-top: 2rem;
}

.menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.menu-item {
  border: 1px solid #ddd;
  border-radius: 5px;
  padding: 1rem;
  text-align: center;
}

.menu-item button {
  background-color: #4CAF50;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: 3px;
  margin-top: 0.5rem;
}

.price {
  font-weight: bold;
  color: #e91e63;
}

.cart-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #ddd;
  padding: 1rem 0;
}

.cart-controls {
  display: flex;
  align-items: center;
}

.cart-controls button {
  background-color: #f1f1f1;
  border: none;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 1.2rem;
}

.cart-quantity {
  margin: 0 10px;
}

.remove-button {
  background-color: #ff5252 !important;
  color: white;
}

#checkout-button {
  background-color: #4CAF50;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: 3px;
  margin-top: 1rem;
}`
      });
      
      files.push({
        path: 'frontend/script.js',
        content: `
// Initialize cart from local storage or create empty cart
let cart = JSON.parse(localStorage.getItem('cart')) || [];
updateCartDisplay();

// Function to add an item to the cart
function addToCart(id, name, price) {
  // Check if the item is already in the cart
  const existingItem = cart.find(item => item.id === id);
  
  if (existingItem) {
    // If item exists, increase the quantity
    existingItem.quantity += 1;
  } else {
    // If item doesn't exist, add it to the cart
    cart.push({
      id,
      name,
      price,
      quantity: 1
    });
  }
  
  // Save cart to local storage
  saveCart();
  
  // Update cart display
  updateCartDisplay();
  
  // Show a notification
  alert(\`\${name} added to cart\`);
}

// Function to update the cart quantity in the header
function updateCartDisplay() {
  // Update cart count
  const cartCountElements = document.querySelectorAll('#cart-count');
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  
  cartCountElements.forEach(element => {
    element.textContent = itemCount;
  });
  
  // If we're on the cart page, display the cart items
  const cartItemsContainer = document.getElementById('cart-items');
  if (cartItemsContainer) {
    renderCartItems(cartItemsContainer);
  }
}

// Function to render cart items on the cart page
function renderCartItems(container) {
  // Clear the container
  container.innerHTML = '';
  
  const emptyCartMessage = document.getElementById('empty-cart');
  const cartSummary = document.getElementById('cart-summary');
  
  if (cart.length === 0) {
    container.appendChild(emptyCartMessage);
    cartSummary.style.display = 'none';
    return;
  }
  
  // Hide empty cart message and show summary
  emptyCartMessage.style.display = 'none';
  cartSummary.style.display = 'block';
  
  // Calculate total
  let total = 0;
  
  // Add each cart item
  cart.forEach(item => {
    const cartItem = document.createElement('div');
    cartItem.className = 'cart-item';
    
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    
    cartItem.innerHTML = \`
      <div>
        <h3>\${item.name}</h3>
        <p>$\${item.price.toFixed(2)} each</p>
      </div>
      <div class="cart-controls">
        <button onclick="changeQuantity(\${item.id}, \${item.quantity - 1})">-</button>
        <span class="cart-quantity">\${item.quantity}</span>
        <button onclick="changeQuantity(\${item.id}, \${item.quantity + 1})">+</button>
        <button class="remove-button" onclick="removeItem(\${item.id})">×</button>
      </div>
      <div>$\${itemTotal.toFixed(2)}</div>
    \`;
    
    container.appendChild(cartItem);
  });
  
  // Update total
  document.getElementById('cart-total').textContent = total.toFixed(2);
  
  // Set up checkout button
  document.getElementById('checkout-button').addEventListener('click', function() {
    alert('Thank you for your order!');
    cart = [];
    saveCart();
    updateCartDisplay();
  });
}

// Function to change quantity of a cart item
function changeQuantity(id, newQuantity) {
  // Find the item
  const itemIndex = cart.findIndex(item => item.id === id);
  
  if (itemIndex === -1) return;
  
  // If new quantity is 0 or less, remove the item
  if (newQuantity <= 0) {
    removeItem(id);
    return;
  }
  
  // Update quantity
  cart[itemIndex].quantity = newQuantity;
  
  // Save and update display
  saveCart();
  updateCartDisplay();
}

// Function to remove an item from the cart
function removeItem(id) {
  cart = cart.filter(item => item.id !== id);
  
  // Save and update display
  saveCart();
  updateCartDisplay();
}

// Function to save cart to local storage
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}`
      });
    }
    
    if (!files.some(f => f.path.startsWith('backend/'))) {
      files.push({
        path: 'backend/server.js',
        content: `
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Sample data
const menuItems = [
  { id: 1, name: 'Item 1', description: 'Description of item 1', price: 10.99 },
  { id: 2, name: 'Item 2', description: 'Description of item 2', price: 12.99 },
  { id: 3, name: 'Item 3', description: 'Description of item 3', price: 9.99 },
  { id: 4, name: 'Item 4', description: 'Description of item 4', price: 14.99 },
  { id: 5, name: 'Item 5', description: 'Description of item 5', price: 11.99 },
  { id: 6, name: 'Item 6', description: 'Description of item 6', price: 8.99 },
];

// Routes
app.get('/api', (req, res) => {
  res.json({ message: 'API is working!' });
});

app.get('/api/menu', (req, res) => {
  res.json(menuItems);
});

app.get('/api/menu/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const item = menuItems.find(item => item.id === id);
  
  if (!item) {
    return res.status(404).json({ message: 'Item not found' });
  }
  
  res.json(item);
});

// Orders endpoint
app.post('/api/orders', (req, res) => {
  const { items, customerInfo } = req.body;
  
  // Validate request
  if (!items || !items.length) {
    return res.status(400).json({ message: 'No items in order' });
  }
  
  // In a real app, you would save the order to a database
  const order = {
    id: Date.now(),
    items,
    customerInfo,
    status: 'received',
    createdAt: new Date()
  };
  
  res.status(201).json({
    message: 'Order created successfully',
    order
  });
});

// Start the server
app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});`
      });
    }
  }

  // Fix files for proper routing and connectivity between pages
  private fixFilesForProperRouting(files: ProjectFile[]): void {
    // Analyze files to determine project type
    const { projectType, isFullstack } = this.detectProjectType(files);
    
    // Apply specific fixes based on project type
    if (projectType === 'react') {
      this.fixReactRouting(files);
    } else if (projectType === 'vue') {
      this.fixVueRouting(files);
    } else if (projectType === 'angular') {
      this.fixAngularRouting(files);
    } else {
      // For static sites, ensure proper file references
      this.fixStaticSiteRouting(files);
    }
    
    // For fullstack apps, ensure proper API connections
    if (isFullstack) {
      this.fixFullstackConnections(files, projectType);
    }
  }

  // Fix routing for React applications
  private fixReactRouting(files: ProjectFile[]): void {
    // Check if React Router is already set up
    const hasReactRouter = files.some(file => 
      file.content.includes('react-router-dom') ||
      file.content.includes('BrowserRouter') ||
      file.content.includes('Routes') ||
      file.content.includes('Route')
    );
    
    // If no React Router, add it
    if (!hasReactRouter) {
      // Find main App file
      const appFile = files.find(file => 
        file.path.includes('App.') || 
        (file.path.includes('.jsx') && !file.path.includes('index.jsx'))
      );
      
      if (appFile) {
        // Add React Router
        appFile.content = this.addReactRouter(appFile.content);
      }
      
      // Find package.json and add react-router-dom
      const packageJson = files.find(file => file.path.includes('package.json'));
      if (packageJson) {
        try {
          const pkg = JSON.parse(packageJson.content);
          if (!pkg.dependencies) pkg.dependencies = {};
          if (!pkg.dependencies['react-router-dom']) {
            pkg.dependencies['react-router-dom'] = '^6.8.1';
          }
          packageJson.content = JSON.stringify(pkg, null, 2);
        } catch (e) {
          console.error('Error updating package.json:', e);
        }
      }
    }
    
    // Ensure index.html has proper base path for React Router
    const indexHtml = files.find(file => file.path.includes('index.html'));
    if (indexHtml && !indexHtml.content.includes('<base href="/"')) {
      indexHtml.content = indexHtml.content.replace(
        '</head>',
        '  <base href="/" />\n  </head>'
      );
    }
  }

  // Add React Router to an App component
  private addReactRouter(content: string): string {
    // Don't modify if already has router
    if (content.includes('BrowserRouter') || content.includes('Routes')) {
      return content;
    }
    
    // Add React Router imports
    if (!content.includes('react-router-dom')) {
      const importMatch = content.match(/import React(,|\s)*from ['"]react['"];?/);
      if (importMatch) {
        content = content.replace(
          importMatch[0],
          `${importMatch[0]}\nimport { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";`
        );
      } else {
        content = `import React from 'react';\nimport { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";\n${content}`;
      }
    }
    
    // Replace links with React Router Links
    content = content.replace(/<a href="([^"]+)"/g, (match, href) => {
      if (href.startsWith('http') || href.startsWith('#')) {
        return match;
      }
      return `<Link to="${href}"`;
    });
    
    content = content.replace(/<\/a>/g, '</Link>');
    
    // Wrap App component with Router
    const appComponentMatch = content.match(/function App\(\) {[\s\S]*?return \(([\s\S]*?)\);/);
    if (appComponentMatch) {
      content = content.replace(
        appComponentMatch[0],
        `function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={${appComponentMatch[1]}} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/cart" element={<Cart />} />
      </Routes>
    </Router>
  );`
      );
      
      // Add placeholder components for routes
      content += `

function Menu() {
  return (
    <div>
      <h2>Menu</h2>
      <div className="menu-grid">
        {/* Menu items would go here */}
        <div className="menu-item">
          <h3>Item 1</h3>
          <p>Description of item 1</p>
          <p className="price">$10.99</p>
          <button>Add to Cart</button>
        </div>
        <div className="menu-item">
          <h3>Item 2</h3>
          <p>Description of item 2</p>
          <p className="price">$12.99</p>
          <button>Add to Cart</button>
        </div>
      </div>
    </div>
  );
}

function Cart() {
  return (
    <div>
      <h2>Shopping Cart</h2>
      <div id="cart-items">
        <p>Your cart is empty.</p>
      </div>
    </div>
  );
}`;
    }
    
    return content;
  }

  // Fix routing for Vue applications
  private fixVueRouting(files: ProjectFile[]): void {
    // Similar implementation to fixReactRouting
    // but for Vue Router
  }

  // Fix routing for Angular applications
  private fixAngularRouting(files: ProjectFile[]): void {
    // Similar implementation for Angular Router
  }

  // Fix routing for static HTML sites
  private fixStaticSiteRouting(files: ProjectFile[]): void {
    // Get all HTML files
    const htmlFiles = files.filter(file => file.path.endsWith('.html'));
    
    // Ensure all navigation links are correct
    for (const htmlFile of htmlFiles) {
      // Fix links to point to correct files
      for (const otherFile of htmlFiles) {
        const filename = path.basename(otherFile.path);
        // Ensure links correctly point to files
        const linkRegex = new RegExp(`href=["']${filename}["']`, 'g');
        if (!htmlFile.content.match(linkRegex) && htmlFile.content.toLowerCase().includes(filename.toLowerCase())) {
          // Try to fix incorrect links by finding close matches
          htmlFile.content = htmlFile.content.replace(
            new RegExp(`href=["'][^"']*${filename.replace('.html', '')}[^"']*["']`, 'i'),
            `href="${filename}"`
          );
        }
      }
      
      // Make sure script and css links are correct
      if (htmlFile.content.includes('href="styles.css"') && !files.some(f => f.path.endsWith('/styles.css'))) {
        // Find a CSS file to use
        const cssFile = files.find(f => f.path.endsWith('.css'));
        if (cssFile) {
          const cssFilename = path.basename(cssFile.path);
          htmlFile.content = htmlFile.content.replace(/href="styles\.css"/g, `href="${cssFilename}"`);
        }
      }
      
      if (htmlFile.content.includes('src="script.js"') && !files.some(f => f.path.endsWith('/script.js'))) {
        // Find a JS file to use
        const jsFile = files.find(f => f.path.endsWith('.js') && !f.path.includes('server.js'));
        if (jsFile) {
          const jsFilename = path.basename(jsFile.path);
          htmlFile.content = htmlFile.content.replace(/src="script\.js"/g, `src="${jsFilename}"`);
        }
      }
    }
  }

  // Fix connections between frontend and backend in fullstack apps
  private fixFullstackConnections(files: ProjectFile[], projectType: string): void {
    // Find backend port
    let backendPort = 3001;
    const serverFiles = files.filter(file => 
      file.content.includes('app.listen') || 
      file.content.includes('createServer')
    );
    
    for (const serverFile of serverFiles) {
      const portMatch = serverFile.content.match(/(?:PORT|port)\s*[=|:]\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+)/);
      if (portMatch) {
        backendPort = parseInt(portMatch[1]);
        break;
      }
    }
    
    // Update API URLs in frontend files to point to the correct port
    const apiBaseUrl = `http://localhost:${backendPort}`;
    
    for (const file of files) {
      if (!file.path.includes('backend/') && !file.path.includes('server.js')) {
        // Replace hardcoded API URLs with the correct port
        file.content = file.content.replace(
          /(['"`])http:\/\/localhost:\d+\/api\//g,
          `$1${apiBaseUrl}/api/`
        );
        
        // If no API URLs are found, inject the base URL where appropriate
        if (projectType === 'react' && file.content.includes('fetch(') && !file.content.includes(apiBaseUrl)) {
          // For React, add a baseUrl constant
          if (file.content.includes('import React')) {
            file.content = file.content.replace(
              /import React/,
              `import React\n\n// API Base URL\nconst API_BASE_URL = '${apiBaseUrl}';\n`
            );
            
            // Replace fetch calls to use the base URL
            file.content = file.content.replace(
              /fetch\(['"](\/api\/[^'"]+)['"]/g,
              `fetch(\`\${API_BASE_URL}$1\``
            );
          }
        } else if (file.path.endsWith('.js') && file.content.includes('fetch(') && !file.content.includes(apiBaseUrl)) {
          // For regular JS files
          if (!file.content.includes('const API_BASE_URL')) {
            file.content = `// API Base URL\nconst API_BASE_URL = '${apiBaseUrl}';\n\n${file.content}`;
          }
          
          // Replace fetch calls
          file.content = file.content.replace(
            /fetch\(['"](\/api\/[^'"]+)['"]/g,
            `fetch(\`\${API_BASE_URL}$1\``
          );
        }
      }
    }
    
    // Make sure the backend has CORS enabled
    for (const serverFile of serverFiles) {
      if (!serverFile.content.includes('cors(')) {
        // Add cors middleware
        if (serverFile.content.includes('app.use(')) {
          serverFile.content = serverFile.content.replace(
            /(const app\s*=\s*express\(\);)/,
            `$1\n\n// Enable CORS for frontend\napp.use(cors());`
          );
        }
        
        // Add cors import if it doesn't exist
        if (!serverFile.content.includes("require('cors')") && !serverFile.content.includes('require("cors")')) {
          serverFile.content = serverFile.content.replace(
            /(const express\s*=\s*require\(['"]express['"]\);)/,
            `$1\nconst cors = require('cors');`
          );
        }
      }
    }
  }

  // Helper methods to extract content from mixed code
  private extractHtmlContent(code: string): string | null {
    const htmlMatch = /<html[\s\S]*?<\/html>/i.exec(code) || 
                      /<!DOCTYPE[\s\S]*?<\/html>/i.exec(code);
    return htmlMatch ? htmlMatch[0] : null;
  }

  private extractCssContent(code: string): string | null {
    const styleMatches = code.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (!styleMatches) return null;
    
    return styleMatches
      .map(match => /<style[^>]*>([\s\S]*?)<\/style>/i.exec(match)?.[1] || '')
      .join('\n\n');
  }

  private extractJsContent(code: string): string | null {
    const scriptMatches = code.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    if (!scriptMatches) return null;
    
    return scriptMatches
      .map(match => /<script[^>]*>([\s\S]*?)<\/script>/i.exec(match)?.[1] || '')
      .join('\n\n');
  }

  // Create and set up a new project
  public async createProject(files: ProjectFile[]): Promise<{
    projectId: string;
    projectType: string;
    isFullstack: boolean;
  }> {
    const { projectType, isFullstack } = this.detectProjectType(files);
    const projectId = crypto.randomBytes(4).toString('hex');
    const projectDir = path.join(os.tmpdir(), `fullstack-${projectId}`);
    
    console.log(`Creating ${projectType} project (${isFullstack ? 'fullstack' : 'single-tier'})`);
    
    // Initialize project structure
    try {
      await fs.mkdir(projectDir, { recursive: true });
      
      // Create frontend and backend directories
      await fs.mkdir(path.join(projectDir, 'frontend'), { recursive: true });
      if (isFullstack) {
        await fs.mkdir(path.join(projectDir, 'backend'), { recursive: true });
      }
      
      // Write all files
      for (const file of files) {
        const filePath = path.join(projectDir, file.path);
        const dirPath = path.dirname(filePath);
        
        // Create directory if it doesn't exist
        await fs.mkdir(dirPath, { recursive: true });
        
        // Write file content
        await fs.writeFile(filePath, file.content);
      }
      
      // Store project information
      this.projects.set(projectId, {
        projectDir,
        projectType,
        isFullstack,
        frontendPort: 3002,
        backendPort: 3001,
        logs: []
      });
      
      return { projectId, projectType, isFullstack };
    } catch (error) {
      console.error('Error creating project:', error);
      throw new Error('Failed to create project files');
    }
  }

  // Start the project servers
  public async startProject(projectId: string): Promise<ProjectRuntime> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    
    try {
      // Install dependencies
      await this.installDependencies(project.projectDir, project.projectType);
      
      // Start servers
      let backendPort = 0;
      if (project.isFullstack) {
        // Start backend first
        backendPort = await this.startBackendServer(projectId);
      }
      
      // Start frontend
      const frontendPort = await this.startFrontendServer(projectId, project.projectType);
      
      return {
        projectId,
        frontendPort,
        backendPort,
        frontendUrl: `http://localhost:${frontendPort}`,
        backendUrl: backendPort ? `http://localhost:${backendPort}` : '',
        projectType: project.projectType,
        logs: [...project.logs]
      };
    } catch (error) {
      console.error('Error starting project:', error);
      throw new Error('Failed to start project servers');
    }
  }

  // Stop project servers
  public stopProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    
    if (project.frontendServer) {
      project.frontendServer.kill();
      project.frontendServer = undefined;
      project.logs.push('Frontend server stopped');
    }
    
    if (project.backendServer) {
      project.backendServer.kill();
      project.backendServer = undefined;
      project.logs.push('Backend server stopped');
    }
  }

  // Clean up project files
  public async cleanupProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;
    
    // Stop servers first
    this.stopProject(projectId);
    
    // Delete project directory
    try {
      await fs.rm(project.projectDir, { recursive: true, force: true });
      this.projects.delete(projectId);
    } catch (error) {
      console.error('Error cleaning up project:', error);
      throw new Error('Failed to clean up project files');
    }
  }

  // Get project status
  public getProjectStatus(projectId: string): {
    isRunning: boolean;
    projectType: string;
    isFullstack: boolean;
    logs: string[];
    ports: { frontend: number; backend: number };
  } {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    
    return {
      isRunning: !!(project.frontendServer || project.backendServer),
      projectType: project.projectType,
      isFullstack: project.isFullstack,
      logs: [...project.logs],
      ports: {
        frontend: project.frontendPort,
        backend: project.backendPort
      }
    };
  }

  // Install dependencies for the project
  private async installDependencies(
    projectDir: string, 
    projectType: string
  ): Promise<void> {
    const frontendDir = path.join(projectDir, 'frontend');
    const backendDir = path.join(projectDir, 'backend');
    
    try {
      // First find the project by directory
      const projectId = Object.keys(this.projects).find(id => 
        this.projects.get(id)?.projectDir === projectDir
      );
      
      if (!projectId) {
        throw new Error('Project not found during dependency installation');
      }
      
      const project = this.projects.get(projectId);
      if (!project) {
        throw new Error('Project not found during dependency installation');
      }

      // Helper function to install dependencies
      const installDeps = async (dir: string) => {
        try {
          if (await this.fileExists(path.join(dir, 'package.json'))) {
            // Check if node_modules already exists to prevent unnecessary installs
            if (!await this.fileExists(path.join(dir, 'node_modules'))) {
              project.logs.push(`Installing dependencies in ${dir}...`);
              await execAsync(`cd ${dir} && npm install --quiet`, { timeout: 120000 });
              project.logs.push(`Dependencies installed in ${dir}`);
            } else {
              project.logs.push(`Using existing node_modules in ${dir}`);
            }
          }
        } catch (error) {
          project.logs.push(`Error installing dependencies in ${dir}: ${error}`);
          throw error;
        }
      };
      
      // Install backend dependencies if needed
      if (await this.fileExists(backendDir)) {
        await installDeps(backendDir);
      }
      
      // Install frontend dependencies
      if (projectType === 'static') {
        // For static sites, ensure we have a server to serve files
        const staticServerPkg = {
          name: "static-site",
          version: "1.0.0",
          scripts: {
            "start": "serve -s ."
          },
          dependencies: {
            "serve": "^14.2.0"
          }
        };
        
        // Check if package.json exists, if not create it
        if (!await this.fileExists(path.join(frontendDir, 'package.json'))) {
          await fs.writeFile(
            path.join(frontendDir, 'package.json'),
            JSON.stringify(staticServerPkg, null, 2)
          );
        }
      }
      
      // Install frontend dependencies
      await installDeps(frontendDir);
    } catch (error) {
      console.error('Error installing dependencies:', error);
      throw new Error('Failed to install dependencies');
    }
  }

  // Start backend server
  private async startBackendServer(projectId: string): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    
    const backendDir = path.join(project.projectDir, 'backend');
    
    // Stop existing server if running
    if (project.backendServer) {
      project.backendServer.kill();
    }
    
    // Find the main server file
    let mainFile = 'server.js';
    try {
      const files = await fs.readdir(backendDir);
      if (files.includes('app.js')) {
        mainFile = 'app.js';
      } else if (files.includes('index.js')) {
        mainFile = 'index.js';
      }
    } catch (error) {
      console.error("Error finding main backend file:", error);
    }
    
    // Set environment variables
    const env = {
      ...process.env,
      PORT: project.backendPort.toString(),
      NODE_ENV: 'development'
    };
    
    try {
      // Start the server
      project.backendServer = spawn('node', [mainFile], {
        cwd: backendDir,
        env,
        stdio: 'pipe'
      });
      
      project.logs.push(`Backend server started on port ${project.backendPort}`);
      
      // Log output and errors
      project.backendServer.stdout?.on('data', (data) => {
        const log = `[Backend] ${data.toString().trim()}`;
        console.log(log);
        project.logs.push(log);
      });
      
      project.backendServer.stderr?.on('data', (data) => {
        const log = `[Backend Error] ${data.toString().trim()}`;
        console.error(log);
        project.logs.push(log);
      });
      
      // Handle server exit
      project.backendServer.on('exit', (code) => {
        if (code !== 0) {
          const errorLog = `[Backend] Server crashed with code ${code}`;
          console.error(errorLog);
          project.logs.push(errorLog);
        }
      });
      
      // Wait a bit to ensure server has started
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return project.backendPort;
    } catch (error) {
      console.error("Error starting backend server:", error);
      throw new Error(`Failed to start backend server: ${error}`);
    }
  }

  // Start frontend server
  private async startFrontendServer(projectId: string, projectType: string): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    
    const frontendDir = path.join(project.projectDir, 'frontend');
    
    // Stop existing server if running
    if (project.frontendServer) {
      project.frontendServer.kill();
    }
    
    // Prepare the environment
    const env = {
      ...process.env,
      PORT: project.frontendPort.toString(),
      NODE_ENV: 'development',
      BROWSER: 'none' // Prevent auto-opening browser
    };
    
    try {
      // Launch the appropriate server based on project type
      switch (projectType) {
        case 'react':
          project.frontendServer = spawn('npm', ['start'], {
            cwd: frontendDir,
            env,
            stdio: 'pipe'
          });
          break;
          
        case 'vue':
          project.frontendServer = spawn('npm', ['run', 'serve'], {
            cwd: frontendDir,
            env,
            stdio: 'pipe'
          });
          break;
          
        case 'angular':
          project.frontendServer = spawn('npm', ['run', 'start'], {
            cwd: frontendDir,
            env,
            stdio: 'pipe'
          });
          break;
          
        case 'static':
        default:
          // For static sites, use serve
          project.frontendServer = spawn('npx', ['serve', '-s', '.', '-p', project.frontendPort.toString()], {
            cwd: frontendDir,
            stdio: 'pipe'
          });
          break;
      }
      
      project.logs.push(`Frontend server started on port ${project.frontendPort}`);
      
      // Log output and errors
      project.frontendServer.stdout?.on('data', (data) => {
        const log = `[Frontend] ${data.toString().trim()}`;
        console.log(log);
        project.logs.push(log);
      });
      
      project.frontendServer.stderr?.on('data', (data) => {
        const log = `[Frontend Error] ${data.toString().trim()}`;
        console.error(log);
        project.logs.push(log);
      });
      
      // Handle server exit
      project.frontendServer.on('exit', (code) => {
        if (code !== 0) {
          const errorLog = `[Frontend] Server crashed with code ${code}`;
          console.error(errorLog);
          project.logs.push(errorLog);
        }
      });
      
      // Wait a bit to ensure server has started
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return project.frontendPort;
    } catch (error) {
      console.error("Error starting frontend server:", error);
      throw new Error(`Failed to start frontend server: ${error}`);
    }
  }

  // Helper to check if a file exists
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}