-- Create chat_sessions table if not exists
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Ensure chat_messages table has session_id with correct foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'chat_messages' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE "chat_messages" ADD COLUMN "session_id" integer NOT NULL 
      REFERENCES "chat_sessions"("id") ON DELETE CASCADE;
  END IF;
END
$$;

-- Create an index for faster lookups
CREATE INDEX IF NOT EXISTS "idx_chat_messages_session_id" ON "chat_messages" ("session_id");