CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY,
	"house_no" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"amount" numeric(12,2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"house_no" text PRIMARY KEY,
	"owner" text,
	"status" text DEFAULT 'Unregistered' NOT NULL,
	"bf_2025" numeric(12,2),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"estimated_cost" numeric(12,2),
	"quotations_received" integer DEFAULT 0 NOT NULL,
	"saved" numeric(12,2),
	"status" text DEFAULT 'Planned' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY,
	"tx_date" date,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_plot_period_idx" ON "collections" ("house_no","year","month");--> statement-breakpoint
CREATE INDEX "collections_period_idx" ON "collections" ("year","month");--> statement-breakpoint
CREATE INDEX "plots_status_idx" ON "plots" ("status");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" ("tx_date");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_house_no_plots_house_no_fkey" FOREIGN KEY ("house_no") REFERENCES "plots"("house_no") ON DELETE CASCADE;