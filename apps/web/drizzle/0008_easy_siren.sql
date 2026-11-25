CREATE TABLE "media" (
	"area_id" uuid,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"height" integer NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"type" text NOT NULL,
	"width" integer NOT NULL,
	CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('brand', 'library')),
	CONSTRAINT "media_type_check" CHECK ("media"."type" in ('jpeg', 'png')),
	CONSTRAINT "media_area_check" CHECK (("media"."purpose" = 'library') = ("media"."area_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;