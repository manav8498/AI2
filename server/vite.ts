// server/vite.ts
import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import { nanoid } from "nanoid";
import viteConfig from "../vite.config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Get the actual port the server is listening on
  const address = server.address();
  let port: number | undefined = undefined;
  
  if (address && typeof address !== 'string') {
    port = address.port;
  } else {
    // Fallback to environment variable or undefined (let Vite pick)
    port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  }
  
  // Create base server options
  const serverOptions = {
    middlewareMode: true as const,
    hmr: { 
      server,
      port: port, // Use the same port as the Express server
      protocol: 'ws'
    }
  };

  // Initialize crypto for Node.js environment
  if (typeof global !== 'undefined' && !global.crypto) {
    const { webcrypto } = await import('node:crypto');
    // @ts-ignore - Type 'Crypto' is not assignable to type 'Crypto'
    global.crypto = webcrypto;
  }

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Ignore URI malformed errors from Vite middleware
        if (msg.includes("URI malformed")) {
          viteLogger.warn("Suppressed URI malformed error from Vite middleware", options);
          return;
        }
        viteLogger.error(msg, options);
      },
    },
    server: serverOptions,
    appType: "custom",
    define: {
      ...viteConfig.define,
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
  });

  // Add custom error handling middleware before Vite middleware
  app.use((req, res, next) => {
    try {
      // Safety check for malformed URLs
      const url = req.url;
      if (url && url.includes('%') && url.includes('..')) {
        log(`Blocked potentially malformed URL: ${url}`, "security");
        return res.status(400).send("Invalid URL format");
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(vite.middlewares);
  
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // Validate URL before processing
      if (!url || url.includes('\uFFFD')) {
        throw new Error("Invalid URL characters detected");
      }

      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });

  return vite;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}