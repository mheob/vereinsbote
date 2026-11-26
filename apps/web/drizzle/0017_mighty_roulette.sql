CREATE TABLE "occasions" (
	"archived_at" timestamp with time zone,
	"area_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"unsubscribe" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "occasions_kind_check" CHECK ("occasions"."kind" in ('personal', 'circular')),
	CONSTRAINT "occasions_trigger_check" CHECK ("occasions"."trigger" in ('manual'))
);
--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "occasions_area_name_lower_idx" ON "occasions" USING btree ("area_id",lower("name"));--> statement-breakpoint
CREATE INDEX "occasions_template_idx" ON "occasions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "occasions_sender_idx" ON "occasions" USING btree ("sender_id");--> statement-breakpoint
-- No occasion existed before this migration, so an opt-out of scope occasion points nowhere.
DELETE FROM "contact_opt_outs" WHERE "scope" = 'occasion';--> statement-breakpoint
ALTER TABLE "contact_opt_outs" ADD CONSTRAINT "contact_opt_outs_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_opt_outs_occasion_idx" ON "contact_opt_outs" USING btree ("kind","contact_key","occasion_id") WHERE "contact_opt_outs"."scope" = 'occasion';