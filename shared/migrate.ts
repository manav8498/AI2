import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

neonConfig.webSocketConstructor = ws;

const runMigration = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log("Running migrations...");

  try {
    // Specify the full path to migrations folder
    const migrationsFolder = join(__dirname, "..", "server", "db", "migrations");
    console.log("Migrations folder:", migrationsFolder);
    
    await migrate(db, { migrationsFolder });
    console.log("Migrations completed!");
  } catch (error) {
    console.error("Migration failed!", error);
    throw error;
  } finally {
    await pool.end();
  }
};

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});