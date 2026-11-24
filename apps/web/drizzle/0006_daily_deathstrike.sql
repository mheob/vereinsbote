ALTER TABLE "user" ADD COLUMN "first_sign_in_at" timestamp with time zone;--> statement-breakpoint
-- Existing data: an active user has signed in (or is the setup admin); so has a disabled one whose
-- address a sign-in verified. Others stay null and are re-enabled as invited.
UPDATE "user" SET "first_sign_in_at" = "updated_at" WHERE "status" = 'active' OR ("status" = 'disabled' AND "email_verified");
