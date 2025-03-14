import { db } from "../../db";
import { sql } from "drizzle-orm";

// This script ensures the required tables exist and have the proper constraints
export async function ensureTables() {
  try {
    // Check if chat_sessions table exists
    const sessionsExist = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'chat_sessions'
      );
    `);

    // Create chat_sessions if it doesn't exist
    if (!sessionsExist.rows[0].exists) {
      await db.execute(sql`
        CREATE TABLE "chat_sessions" (
          "id" serial PRIMARY KEY NOT NULL,
          "name" text NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        );
      `);
    }

    // Create default session if none exists
    const sessionCount = await db.execute(sql`
      SELECT COUNT(*) FROM chat_sessions;
    `);
    
    if (parseInt(sessionCount.rows[0].count) === 0) {
      await db.execute(sql`
        INSERT INTO chat_sessions (name) 
        VALUES ('Default Chat');
      `);
    }

    // Ensure session_id column exists in chat_messages with proper foreign key
    const hasSessionId = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'chat_messages' AND column_name = 'session_id'
      );
    `);

    if (!hasSessionId.rows[0].exists) {
      await db.execute(sql`
        ALTER TABLE "chat_messages" 
        ADD COLUMN "session_id" integer NOT NULL 
        REFERENCES "chat_sessions"("id") ON DELETE CASCADE;
      `);
    }

    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Error initializing database schema:", error);
    throw error;
  }
}