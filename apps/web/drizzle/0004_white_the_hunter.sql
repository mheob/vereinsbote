ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_locale_check" CHECK ("user"."locale" in ('de', 'en'));