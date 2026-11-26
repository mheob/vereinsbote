CREATE TABLE "attachments" (
	"area_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"occasion_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"type" text NOT NULL,
	"wave_id" uuid,
	CONSTRAINT "attachments_type_check" CHECK ("attachments"."type" in ('application/pdf', 'image/jpeg', 'image/png'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_occasion_idx" ON "attachments" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "attachments_wave_idx" ON "attachments" USING btree ("wave_id");