CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
