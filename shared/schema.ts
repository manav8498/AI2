import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Only define the tables we know exist in the database
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().default(1), // Default to session 1
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull()
});

export const generatedFiles = pgTable("generated_files", {
  id: serial("id").primaryKey(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").notNull().$type<{
    language: string;
    size: number;
  }>(),
  timestamp: timestamp("timestamp").defaultNow().notNull()
});

// Create insertion schemas
export const insertChatMessageSchema = z.object({
  sessionId: z.number().default(1),
  role: z.string(),
  content: z.string()
});

export const insertGeneratedFileSchema = createInsertSchema(generatedFiles).omit({
  id: true,
  timestamp: true
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type GeneratedFile = typeof generatedFiles.$inferSelect;
export type InsertGeneratedFile = z.infer<typeof insertGeneratedFileSchema>;