CREATE TABLE IF NOT EXISTS "week_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"week_key" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_weekly_reset" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "week_entries" ADD CONSTRAINT "week_entries_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "week_entries_user_week_idx" ON "week_entries" USING btree ("user_id","week_key");