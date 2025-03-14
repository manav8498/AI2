// server/index.ts
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { 
  initializeDatabase, 
  checkConnection, 
  fixMissingDefaultSession, 
  pool,
  fixChatSessionsTable,
  analyzeDatabase // Make sure this is exported from db.ts
} from "./db";
import { createServer } from "net";

import dotenv from 'dotenv';
dotenv.config();

// Helper function to find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise(resolve => {
      const server = createServer();
      server.on('error', () => {
        resolve(false);
      });
      
      server.listen(port, '0.0.0.0', () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
  };
  
  let port = startPort;
  const maxPort = startPort + 100; // Try up to 100 ports
  
  while (port < maxPort) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  
  throw new Error(`Could not find an available port between ${startPort} and ${maxPort-1}`);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      
      // For session-related endpoints, always log more details
      if (path.includes('/chat/sessions') || path.includes('/chat/messages')) {
        if (req.method === 'POST' && req.body) {
          logLine += ` Request: ${JSON.stringify(req.body)}`;
        }
        
        if (capturedJsonResponse) {
          logLine += ` Response: ${JSON.stringify(capturedJsonResponse)}`;
        }
      } else if (capturedJsonResponse) {
        // For other endpoints, keep it shorter
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      // Truncate very long log lines
      if (logLine.length > 200) {
        logLine = logLine.slice(0, 197) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// For debugging session issues
app.use((req, res, next) => {
  if (req.path.includes('/chat/messages') && req.method === 'POST') {
    const sessionId = req.body?.sessionId;
    log(`Session ID in request body: ${sessionId} (${typeof sessionId})`);
  }
  next();
});

(async () => {
  try {
    // Check database connection first
    log("Checking database connection...");
    const connected = await checkConnection();
    if (!connected) {
      log("Database connection failed! Please check your DATABASE_URL.", "ERROR");
      process.exit(1);
    }
    log("Database connection successful");
    
    // Fix chat_sessions table structure specifically
    log("Fixing chat_sessions table structure...");
    const tableFixed = await fixChatSessionsTable();
    if (!tableFixed) {
      log("WARNING: Could not fix chat_sessions table structure", "WARNING");
    }
    
    // Explicitly fix the default session first (critical for foreign key constraint)
    log("Ensuring default session exists...");
    const defaultSessionFixed = await fixMissingDefaultSession();
    if (!defaultSessionFixed) {
      log("CRITICAL ERROR: Failed to create default session! Messages will fail to save.", "ERROR");
      // Continue despite error, since the app might work in other ways
    } else {
      log("Default session created successfully");
    }
    
    // Initialize database schema and ensure proper structure
    log("Initializing database schema...");
    const initialized = await initializeDatabase();
    if (!initialized) {
      log("Database initialization failed! Continuing with caution.", "WARNING");
    } else {
      log("Database initialization successful");
    }
    
    // Analyze database structure for informational purposes
    log("Analyzing database structure...");
    const dbStructure = await analyzeDatabase();
    log("Database analysis complete");
    
    // Quick validation of critical tables
    if (dbStructure) {
      const tables = Object.keys(dbStructure);
      if (!tables.includes('chat_messages') || !tables.includes('chat_sessions')) {
        log("Warning: Required tables are missing from database!", "WARNING");
      } else {
        // Print count of sessions
        try {
          const sessionCount = await pool.query(`SELECT COUNT(*) FROM chat_sessions;`);
          log(`Found ${sessionCount.rows[0].count} chat sessions`);
          
          // Verify default session
          const defaultSession = await pool.query(`SELECT * FROM chat_sessions WHERE id = 1;`);
          if (defaultSession.rows.length === 0) {
            log("WARNING: Default session (id=1) not found in database!", "WARNING");
          } else {
            log(`Default session: ${JSON.stringify(defaultSession.rows[0])}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log("Error checking sessions: " + errorMessage, "WARNING");
        }
      }
    }
  } catch (error) {
    log("Database setup encountered an error, but continuing with server startup", "WARNING");
    console.error(error);
  }

  // Register API routes
  const server = registerRoutes(app);

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    // Enhanced error logging
    console.error(`Server error (${status}):`, err);
    
    // Don't expose internal error details in production
    const isProduction = app.get("env") === "production";
    const responseBody = {
      message,
      ...(isProduction ? {} : { 
        stack: err.stack,
        code: err.code
      })
    };

    res.status(status).json(responseBody);
  });

  // Set up Vite for development or static serving for production
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Set port with environment variable fallback and handle port conflicts
  try {
    const requestedPort = Number(process.env.PORT) || 3000;
    
    // Find an available port if the requested one is in use
    let port: number;
    try {
      port = await findAvailablePort(requestedPort);
      if (port !== requestedPort) {
        log(`Port ${requestedPort} is in use, using port ${port} instead`, "WARNING");
      }
    } catch (error) {
      log("All ports in range are in use. Please close some applications or specify a different port.", "ERROR");
      process.exit(1);
    }
    
    // Listen on the available port
    server.listen(port, "0.0.0.0", () => {
      log(`Server running at http://localhost:${port} (${app.get("env")} mode)`);
    });
    
    // Add specific error handler for server issues
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        log(`Port ${port} is already in use. Please close the application using this port or specify a different port.`, "ERROR");
      } else {
        log(`Server error: ${error.message}`, "ERROR");
      }
      process.exit(1);
    });
  } catch (error) {
    log(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`, "ERROR");
    process.exit(1);
  }
})().catch(error => {
  console.error("Fatal server error:", error);
  process.exit(1);
});