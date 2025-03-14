-- Check if chat_sessions table exists, if not create it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_sessions') THEN
        CREATE TABLE "chat_sessions" (
            "id" serial PRIMARY KEY NOT NULL,
            "title" text NOT NULL,
            "timestamp" timestamp DEFAULT now() NOT NULL
        );
    END IF;
END
$$;

-- Check if session_id column exists in chat_messages, if not add it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'session_id') THEN
        -- Add the session_id column first
        ALTER TABLE "chat_messages" ADD COLUMN "session_id" integer;
        
        -- Create default session if needed
        INSERT INTO "chat_sessions" ("title") 
        SELECT 'Default Session' 
        WHERE NOT EXISTS (SELECT 1 FROM "chat_sessions" LIMIT 1);
        
        -- Update existing messages to use the default session
        UPDATE "chat_messages" SET "session_id" = (SELECT id FROM "chat_sessions" LIMIT 1)
        WHERE "session_id" IS NULL;
        
        -- Add foreign key constraint
        ALTER TABLE "chat_messages" 
        ADD CONSTRAINT fk_chat_sessions 
        FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id");
        
        -- Make session_id not nullable after updating existing records
        ALTER TABLE "chat_messages" ALTER COLUMN "session_id" SET NOT NULL;
    END IF;
END
$$;