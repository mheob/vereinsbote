CREATE TABLE "login_link_days" (
	"count" integer DEFAULT 0 NOT NULL,
	"day" date NOT NULL,
	"email_hash" text NOT NULL,
	CONSTRAINT "login_link_days_email_hash_day_pk" PRIMARY KEY("email_hash","day")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invitation_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invitation_sent_at" timestamp with time zone;