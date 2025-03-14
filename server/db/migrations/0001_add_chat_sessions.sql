CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add session_id column to chat_messages
ALTER TABLE "chat_messages" ADD COLUMN "session_id" text NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX "idx_chat_messages_session_id" ON "chat_messages" ("session_id");