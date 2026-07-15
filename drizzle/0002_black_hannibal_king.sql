ALTER TYPE "public"."recurrence" ADD VALUE 'custom';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_interval_days" integer;