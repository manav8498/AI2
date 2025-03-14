// server/storage.ts
import { ChatMessage, InsertChatMessage, GeneratedFile, InsertGeneratedFile } from "@shared/schema";
import { db } from "./db";
import { chatMessages, generatedFiles } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";

// In-memory storage for sessions
const chatSessionsInMemory = new Map<number, {
  id: number;
  title: string; // Changed from name to title
  createdAt: Date;
}>();

// Counter for session IDs (start at 100 to avoid conflicts)
let nextSessionId = 100;

// Session type definition
export type ChatSession = {
  id: number;
  title: string; // Changed from name to title
  createdAt: Date;
};

export type InsertChatSession = {
  title: string; // Changed from name to title
};

// Initialize with a default session
chatSessionsInMemory.set(1, {
  id: 1,
  title: "Default Chat", // Changed from name to title
  createdAt: new Date()
});

export interface IStorage {
  getChatSessions(): Promise<ChatSession[]>;
  getChatSessionById(id: number): Promise<ChatSession | undefined>;
  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  deleteChatSession(id: number): Promise<void>;
  getSessionMessages(sessionId: number): Promise<ChatMessage[]>;
  addChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearSessionMessages(sessionId: number): Promise<void>;
  getGeneratedFiles(): Promise<GeneratedFile[]>;
  addGeneratedFile(file: InsertGeneratedFile): Promise<GeneratedFile>;
  clearChat(): Promise<void>;
  clearFiles(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Chat session methods - using in-memory storage only
  async getChatSessions(): Promise<ChatSession[]> {
    // Ensure default session exists
    if (!chatSessionsInMemory.has(1)) {
      chatSessionsInMemory.set(1, {
        id: 1,
        title: "Default Chat", // Changed from name to title
        createdAt: new Date()
      });
    }
    
    return Array.from(chatSessionsInMemory.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getChatSessionById(id: number): Promise<ChatSession | undefined> {
    // Ensure id is a number
    const numericId = typeof id === 'number' ? id : parseInt(String(id), 10);
    
    // Default to 1 if NaN
    const sessionId = isNaN(numericId) ? 1 : numericId;
    
    return chatSessionsInMemory.get(sessionId);
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const id = nextSessionId++;
    const newSession = {
      id,
      title: session.title, // Changed from name to title
      createdAt: new Date()
    };
    
    chatSessionsInMemory.set(id, newSession);
    
    // Also create in database for persistence
    try {
      await db.execute(sql`
        INSERT INTO chat_sessions (id, title, timestamp) 
        VALUES (${id}, ${session.title}, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
    } catch (error) {
      console.error("Error creating session in database:", error);
      // Continue anyway since we have it in memory
    }
    
    return newSession;
  }

  // Helper method to ensure default session exists in database
  async createDefaultSession(): Promise<boolean> {
    try {
      // Try with title column first (seems to be what's in the DB based on error)
      await db.execute(sql`
        INSERT INTO chat_sessions (id, title, timestamp) 
        VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING;
      `);
      console.log("Created default session with title column");
      return true;
    } catch (error) {
      console.error("Error creating default session:", error);
      try {
        // Try with name column as fallback
        await db.execute(sql`
          INSERT INTO chat_sessions (id, name, created_at) 
          VALUES (1, 'Default Chat', CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO NOTHING;
        `);
        console.log("Created default session with name column");
        return true;
      } catch (secondError) {
        console.error("Error creating default session with name column:", secondError);
        return false;
      }
    }
  }

  async deleteChatSession(id: number): Promise<void> {
    // Skip deletion of default session
    if (id === 1) {
      return;
    }
    
    // Delete messages for this session
    try {
      await db.execute(sql`
        DELETE FROM chat_messages 
        WHERE session_id = ${id};
      `);
    } catch (error) {
      console.error(`Error deleting messages for session ${id}:`, error);
    }
    
    // Remove from in-memory store
    chatSessionsInMemory.delete(id);
  }

  // Chat message methods - using raw SQL for robustness
  async getSessionMessages(sessionId: number): Promise<ChatMessage[]> {
    // Ensure sessionId is a number and default to 1 if invalid
    const numericId = typeof sessionId === 'number' ? sessionId : parseInt(String(sessionId), 10);
    const safeSessionId = isNaN(numericId) ? 1 : numericId;
    
    try {
      const result = await db.execute(sql`
        SELECT id, session_id, role, content, timestamp
        FROM chat_messages 
        WHERE session_id = ${safeSessionId}
        ORDER BY timestamp ASC;
      `);
      
      return result.rows.map(row => ({
        id: this.ensureNumber(row.id),
        sessionId: this.ensureNumber(row.session_id),
        role: this.ensureString(row.role),
        content: this.ensureString(row.content),
        timestamp: this.ensureDate(row.timestamp)
      }));
    } catch (error) {
      console.error(`Error getting messages for session ${safeSessionId}:`, error);
      return [];
    }
  }

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    try {
      // Ensure message sessionId is a number and default to 1 if invalid
      const numericId = typeof message.sessionId === 'number' 
        ? message.sessionId 
        : parseInt(String(message.sessionId), 10);
      
      const safeSessionId = isNaN(numericId) ? 1 : numericId;
      
      // Check if session exists in memory and create if not
      if (!chatSessionsInMemory.has(safeSessionId)) {
        console.log(`Creating session ${safeSessionId} since it doesn't exist`);
        
        // Try to add the session to both memory and database
        chatSessionsInMemory.set(safeSessionId, {
          id: safeSessionId,
          title: `Chat ${safeSessionId}`,
          createdAt: new Date()
        });
        
        // Now try to insert the session into the database
        try {
          await db.execute(sql`
            INSERT INTO chat_sessions (id, title, timestamp) 
            VALUES (${safeSessionId}, ${'Chat ' + safeSessionId}, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO NOTHING;
          `);
        } catch (sessionError) {
          console.error(`Error creating session ${safeSessionId}:`, sessionError);
          
          // If we failed to create the requested session, use default session
          await this.createDefaultSession();
          message.sessionId = 1;
        }
      } else {
        message.sessionId = safeSessionId;
      }
      
      console.log(`Inserting message with session_id: ${message.sessionId}`);
      
      const result = await db.execute(sql`
        INSERT INTO chat_messages (session_id, role, content) 
        VALUES (${message.sessionId}, ${message.role}, ${message.content})
        RETURNING id, session_id, role, content, timestamp;
      `);
      
      const row = result.rows[0];
      return {
        id: this.ensureNumber(row.id),
        sessionId: this.ensureNumber(row.session_id),
        role: this.ensureString(row.role),
        content: this.ensureString(row.content),
        timestamp: this.ensureDate(row.timestamp)
      };
    } catch (error) {
      console.error("Error adding chat message:", error);
      
      // If that fails, try to create default session and use it
      await this.createDefaultSession();
      
      // Try a simple insert with guaranteed session_id
      try {
        const backup = await db.execute(sql`
          INSERT INTO chat_messages (session_id, role, content) 
          VALUES (1, ${message.role}, ${message.content})
          RETURNING id, session_id, role, content, timestamp;
        `);
        
        const row = backup.rows[0];
        return {
          id: this.ensureNumber(row.id),
          sessionId: 1, // Default
          role: this.ensureString(row.role),
          content: this.ensureString(row.content),
          timestamp: this.ensureDate(row.timestamp)
        };
      } catch (secondError) {
        const e = secondError instanceof Error ? secondError : new Error(String(secondError));
        throw new Error("Could not add message to database: " + e.message);
      }
    }
  }

  // Implementation of the clearSessionMessages method that was missing
  async clearSessionMessages(sessionId: number): Promise<void> {
    // Ensure sessionId is a number
    const numericId = typeof sessionId === 'number' ? sessionId : parseInt(String(sessionId), 10);
    const safeSessionId = isNaN(numericId) ? 1 : numericId;
    
    try {
      await db.execute(sql`
        DELETE FROM chat_messages 
        WHERE session_id = ${safeSessionId};
      `);
    } catch (error) {
      console.error(`Error clearing messages for session ${safeSessionId}:`, error);
      throw error;
    }
  }

  // Implementation of the getGeneratedFiles method that was missing
  async getGeneratedFiles(): Promise<GeneratedFile[]> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM generated_files 
        ORDER BY timestamp DESC;
      `);
      
      return result.rows.map(row => ({
        id: this.ensureNumber(row.id),
        path: this.ensureString(row.path),
        content: this.ensureString(row.content),
        metadata: this.ensureMetadata(row.metadata),
        timestamp: this.ensureDate(row.timestamp)
      }));
    } catch (error) {
      console.error("Error getting generated files:", error);
      return [];
    }
  }

  // Implementation of the addGeneratedFile method that was missing
  async addGeneratedFile(file: InsertGeneratedFile): Promise<GeneratedFile> {
    try {
      const result = await db.execute(sql`
        INSERT INTO generated_files (path, content, metadata) 
        VALUES (${file.path}, ${file.content}, ${JSON.stringify(file.metadata)})
        RETURNING id, path, content, metadata, timestamp;
      `);
      
      const row = result.rows[0];
      return {
        id: this.ensureNumber(row.id),
        path: this.ensureString(row.path),
        content: this.ensureString(row.content),
        metadata: this.ensureMetadata(row.metadata),
        timestamp: this.ensureDate(row.timestamp)
      };
    } catch (error) {
      console.error("Error adding generated file:", error);
      throw error;
    }
  }

  // Implementation of the clearChat method that was missing
  async clearChat(): Promise<void> {
    try {
      await db.execute(sql`DELETE FROM chat_messages;`);
    } catch (error) {
      console.error("Error clearing chat:", error);
      throw error;
    }
  }

  // Implementation of the clearFiles method that was missing
  async clearFiles(): Promise<void> {
    try {
      await db.execute(sql`DELETE FROM generated_files;`);
    } catch (error) {
      console.error("Error clearing files:", error);
      throw error;
    }
  }

  // Private helper methods for type safety
  private ensureNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) return parsed;
    }
    return 0; // Safe default
  }

  private ensureString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  private ensureDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      try {
        return new Date(value);
      } catch (e) {
        // Fall through to default
      }
    }
    return new Date(); // Safe default
  }

  private ensureMetadata(value: unknown): { language: string; size: number } {
    if (value && typeof value === 'object') {
      // Try to cast to expected shape
      const metadata = value as any;
      return {
        language: this.ensureString(metadata.language || ''),
        size: this.ensureNumber(metadata.size || 0)
      };
    }
    
    // Return default metadata if invalid
    return {
      language: '',
      size: 0
    };
  }
}

export const storage = new DatabaseStorage();