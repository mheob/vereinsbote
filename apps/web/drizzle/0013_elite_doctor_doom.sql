CREATE TABLE "outbox_entries" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_error_code" text,
	"message_id" text,
	"next_attempt_at" timestamp with time zone,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"priority" text NOT NULL,
	"provider_id" text,
	"recipient" text,
	"sender_id" uuid,
	"sent_at" timestamp with time zone,
	"source" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	CONSTRAINT "outbox_entries_source_check" CHECK ("outbox_entries"."source" in ('wave')),
	CONSTRAINT "outbox_entries_priority_check" CHECK ("outbox_entries"."priority" in ('personal', 'group')),
	CONSTRAINT "outbox_entries_status_check" CHECK ("outbox_entries"."status" in ('planned', 'sending', 'sent', 'bounced', 'failed', 'skipped', 'cancelled', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "send_quota_days" (
	"count" integer DEFAULT 0 NOT NULL,
	"day" date NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "send_quota_days_scope_day_pk" PRIMARY KEY("scope","day")
);
--> statement-breakpoint
ALTER TABLE "outbox_entries" ADD CONSTRAINT "outbox_entries_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_entries_status_not_before_idx" ON "outbox_entries" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "outbox_entries_sender_status_idx" ON "outbox_entries" USING btree ("sender_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_entries_message_id_idx" ON "outbox_entries" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "outbox_entries_provider_id_idx" ON "outbox_entries" USING btree ("provider_id");