// server/db.ts
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';

// Load environment variables
dotenv.config();

// Required for Neon serverless driver
neonConfig.webSocketConstructor = ws;

// Validate DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined');
}

// Create connection pool with enhanced error handling
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10, // Maximum number of clients
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection cannot be established
});

// Add error listener to catch connection issues
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  // Don't exit the process, just log the error
});

// Create the database instance WITHOUT schema reference
export const db = drizzle(pool);

// Initialize database with required tables and constraints
export async function initializeDatabase() {
  try {
    console.log("Checking database structure...");
    
    // Step 1: Check if chat_sessions table exists
    const sessionsTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chat_sessions'
      );
    `);
    
    // Step 2: Create chat_sessions table if it doesn't exist
    if (!sessionsTableExists.rows[0].exists) {
      console.log("Creating chat_sessions table...");
      await pool.query(`
        CREATE TABLE chat_sessions (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
    } else {
      // Check if column 'title' exists (could be 'name' in some versions)
      const columnCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'chat_sessions' 
          AND column_name = 'title'
        );
      `);
      
      if (!columnCheck.rows[0].exists) {
        try {
          // Try to add title column
          await pool.query(`
            ALTER TABLE chat_sessions 
            ADD COLUMN title TEXT NOT NULL DEFAULT 'Default Chat';
          `);
        } catch (error) {
          console.error("Error adding title column:", error);
          // It might be that name column is used instead
        }
      }
    }
    
    // Step 3: Ensure default session exists
    console.log("Ensuring default session exists...");
    try {
      await pool.query(`
        INSERT INTO chat_sessions (id, title, timestamp) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    } catch (error) {
      console.error("Error creating default session with 'title':", error);
      try {
        await pool.query(`
          INSERT INTO chat_sessions (id, name, created_at) 
          VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO NOTHING;
        `);
      } catch (secondError) {
        console.error("Error creating default session with 'name':", secondError);
      }
    }
    
    // Step 4: Check if chat_messages table exists
    const messagesTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chat_messages'
      );
    `);
    
    // Step 5: Create chat_messages table if it doesn't exist
    if (!messagesTableExists.rows[0].exists) {
      console.log("Creating chat_messages table...");
      await pool.query(`
        CREATE TABLE chat_messages (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL DEFAULT 1 REFERENCES chat_sessions(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        
        CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
      `);
    } else {
      // Step 6: Check if the foreign key constraint exists
      const constraints = await pool.query(`
        SELECT con.conname, con.contype, col.attname
        FROM pg_constraint con
        JOIN pg_attribute col ON col.attnum = ANY(con.conkey) AND col.attrelid = con.conrelid
        JOIN pg_class tbl ON tbl.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE tbl.relname = 'chat_messages'
        AND ns.nspname = 'public'
        AND col.attname = 'session_id'
        AND con.contype = 'f'
      `);
      
      // If foreign key doesn't exist, add it
      if (constraints.rows.length === 0) {
        try {
          console.log("Adding foreign key constraint to session_id...");
          await pool.query(`
            ALTER TABLE chat_messages 
            ADD CONSTRAINT fk_chat_sessions 
            FOREIGN KEY (session_id) 
            REFERENCES chat_sessions(id);
          `);
        } catch (e) {
          console.error("Failed to add foreign key constraint:", e);
        }
      }
    }
    
    console.log("Database initialization completed successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize database:", error);
    return false;
  }
}

// Run SQL to fix the chat_sessions table specifically if needed
export async function fixChatSessionsTable() {
  try {
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chat_sessions'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      // Create the table with 'title' column
      await pool.query(`
        CREATE TABLE chat_sessions (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
      
      console.log("Created chat_sessions table with 'title' column");
    } else {
      // Get columns to see what we have
      const columns = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'chat_sessions';
      `);
      
      const columnNames = columns.rows.map(row => row.column_name);
      console.log("Existing columns in chat_sessions:", columnNames);
      
      if (!columnNames.includes('title') && !columnNames.includes('name')) {
        // Add title column if neither title nor name exists
        await pool.query(`
          ALTER TABLE chat_sessions 
          ADD COLUMN title TEXT NOT NULL DEFAULT 'Default Chat';
        `);
        console.log("Added 'title' column to chat_sessions");
      }
    }
    
    // Ensure default session exists
    const columnData = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'chat_sessions';
    `);
    
    const columnNames = columnData.rows.map(row => row.column_name);
    
    if (columnNames.includes('title')) {
      await pool.query(`
        INSERT INTO chat_sessions (id, title, timestamp) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    } else if (columnNames.includes('name')) {
      await pool.query(`
        INSERT INTO chat_sessions (id, name, created_at) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    
    console.log("Default session created successfully");
    return true;
  } catch (error) {
    console.error("Error fixing chat_sessions table:", error);
    return false;
  }
}

// Function to analyze database structure
export async function analyzeDatabase() {
  try {
    // Check what tables exist
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    
    // For each table, get its columns
    const tableStructure: Record<string, any> = {};
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      const columnsResult = await pool.query(`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns 
        WHERE table_name = '${tableName}';
      `);
      
      // Get constraints (primary keys, foreign keys, etc.)
      const constraintsResult = await pool.query(`
        SELECT
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM
          information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
        WHERE
          tc.table_name = '${tableName}'
          AND tc.table_schema = 'public';
      `);
      
      // Get indexes
      const indexesResult = await pool.query(`
        SELECT
          indexname,
          indexdef
        FROM
          pg_indexes
        WHERE
          tablename = '${tableName}'
          AND schemaname = 'public';
      `);
      
      tableStructure[tableName] = {
        columns: columnsResult.rows,
        constraints: constraintsResult.rows,
        indexes: indexesResult.rows
      };
    }
    
    console.log("Database structure:", JSON.stringify(tableStructure, null, 2));
    return tableStructure;
  } catch (error) {
    console.error("Failed to analyze database:", error);
    return null;
  }
}

// Function to execute raw SQL safely
export async function executeSQL(query: string, params: any[] = []) {
  try {
    return await pool.query(query, params);
  } catch (error) {
    console.error("SQL Error:", error);
    throw error;
  }
}

// Function to check database connection
export async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW() as now');
    console.log("Database connection successful:", result.rows[0].now);
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

// Function to fix missing default session
export async function fixMissingDefaultSession() {
  try {
    console.log("Checking for default session...");
    
    // Check if sessions table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chat_sessions'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log("Creating chat_sessions table...");
      await pool.query(`
        CREATE TABLE chat_sessions (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
    }
    
    // Check column names
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'chat_sessions';
    `);
    
    const columnNames = columns.rows.map(row => row.column_name);
    
    // Insert the default session with the right column name
    console.log("Creating default session with ID 1...");
    
    if (columnNames.includes('title')) {
      await pool.query(`
        INSERT INTO chat_sessions (id, title, timestamp) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    } else if (columnNames.includes('name')) {
      await pool.query(`
        INSERT INTO chat_sessions (id, name, created_at) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    } else {
      console.error("Cannot determine correct column name for chat_sessions!");
      return false;
    }
    
    // Verify the session was created
    const result = await pool.query(`SELECT * FROM chat_sessions WHERE id = 1;`);
    if (result.rows.length > 0) {
      console.log("Default session verified:", result.rows[0]);
      return true;
    } else {
      console.error("Failed to create default session!");
      return false;
    }
  } catch (error) {
    console.error("Error fixing default session:", error);
    return false;
  }
}