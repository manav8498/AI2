// fix-database.js
import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// Initialize configuration
dotenv.config();

async function fixDatabase() {
  console.log("Starting database fix with correct schema...");
  
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Insert default session with the correct columns
    console.log("Creating default session with title...");
    await pool.query(`
      INSERT INTO chat_sessions (id, title, timestamp) 
      VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE 
      SET title = 'Default Chat';
    `);
    
    // Verify the session
    const sessionCheck = await pool.query(`
      SELECT * FROM chat_sessions WHERE id = 1;
    `);
    
    if (sessionCheck.rows.length > 0) {
      console.log("Default session exists:", sessionCheck.rows[0]);
      
      // Now let's fix the chat_messages table if it has issues
      console.log("Checking for orphaned messages...");
      const orphanedCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'chat_messages' 
          AND column_name = 'session_id'
        );
      `);
      
      if (orphanedCheck.rows[0].exists) {
        // Update any messages with invalid session IDs
        await pool.query(`
          UPDATE chat_messages 
          SET session_id = 1 
          WHERE NOT EXISTS (
            SELECT 1 
            FROM chat_sessions 
            WHERE chat_sessions.id = chat_messages.session_id
          );
        `);
        console.log("Updated any orphaned messages to use session ID 1");
      }
      
      console.log("Database fix completed successfully!");
    } else {
      console.error("ERROR: Failed to create default session!");
    }
  } catch (error) {
    console.error("Error fixing database:", error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixDatabase().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});