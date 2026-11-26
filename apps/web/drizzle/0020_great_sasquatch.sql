CREATE TABLE "contact_bounces" (
	"contact_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"entry_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "contact_bounces_kind_contact_key_email_pk" PRIMARY KEY("kind","contact_key","email"),
	CONSTRAINT "contact_bounces_kind_check" CHECK ("contact_bounces"."kind" in ('member', 'partner')),
	CONSTRAINT "contact_bounces_source_check" CHECK ("contact_bounces"."source" in ('graph', 'resend'))
);
--> statement-breakpoint
CREATE TABLE "wave_contacts" (
	"contact_id" uuid,
	"contact_key" text NOT NULL,
	"email" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "wave_contacts_entry_id_position_pk" PRIMARY KEY("entry_id","position"),
	CONSTRAINT "wave_contacts_kind_check" CHECK ("wave_contacts"."kind" in ('member', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "waves" (
	"area_id" uuid NOT NULL,
	"compiled" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"not_before" timestamp with time zone,
	"occasion_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"salutation_texts" jsonb NOT NULL,
	"sender_id" uuid,
	"stopped_at" timestamp with time zone,
	"stopped_by_user_id" text,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"unsubscribe" boolean NOT NULL,
	CONSTRAINT "waves_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "waves_kind_check" CHECK ("waves"."kind" in ('personal', 'circular'))
);
--> statement-breakpoint
ALTER TABLE "outbox_entries" ADD COLUMN "wave_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_bounces" ADD CONSTRAINT "contact_bounces_entry_id_outbox_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."outbox_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wave_contacts" ADD CONSTRAINT "wave_contacts_entry_id_outbox_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."outbox_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_stopped_by_user_id_user_id_fk" FOREIGN KEY ("stopped_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waves_occasion_idx" ON "waves" USING btree ("occasion_id","created_at");--> statement-breakpoint
CREATE INDEX "waves_area_idx" ON "waves" USING btree ("area_id","created_at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_wave_id_waves_id_fk" FOREIGN KEY ("wave_id") REFERENCES "public"."waves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_entries" ADD CONSTRAINT "outbox_entries_wave_id_waves_id_fk" FOREIGN KEY ("wave_id") REFERENCES "public"."waves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_entries_wave_idx" ON "outbox_entries" USING btree ("wave_id");