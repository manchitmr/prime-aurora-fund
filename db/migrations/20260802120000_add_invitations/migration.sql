CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"token" text NOT NULL,
	"invited_by" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" ("token");
