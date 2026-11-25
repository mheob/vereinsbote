CREATE TABLE "mail_connections" (
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"daily_limit" integer,
	"disturbed_code" text,
	"disturbed_since" timestamp with time zone,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"per_minute" integer,
	"restriction" text,
	"restriction_checked_at" timestamp with time zone,
	"secret_ciphertext" text NOT NULL,
	"secret_expires_on" date,
	"tenant_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"webhook_secret_ciphertext" text,
	CONSTRAINT "mail_connections_kind_check" CHECK ("mail_connections"."kind" in ('graph', 'resend')),
	CONSTRAINT "mail_connections_restriction_check" CHECK ("mail_connections"."restriction" is null or "mail_connections"."restriction" in ('readable', 'restricted', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "sender_areas" (
	"area_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	CONSTRAINT "sender_areas_sender_id_area_id_pk" PRIMARY KEY("sender_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"archive_bcc" text,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"daily_limit" integer,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"per_minute" integer,
	"reply_to" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_areas" ADD CONSTRAINT "sender_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_areas" ADD CONSTRAINT "sender_areas_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_connections_name_lower_idx" ON "mail_connections" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "senders_email_lower_idx" ON "senders" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "senders_single_system_idx" ON "senders" USING btree ("is_system") WHERE "senders"."is_system";