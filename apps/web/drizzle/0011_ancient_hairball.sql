CREATE TABLE "layouts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"html" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_media" (
	"media_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	CONSTRAINT "template_media_template_id_media_id_pk" PRIMARY KEY("template_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"area_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"salutation_form" text NOT NULL,
	"salutation_texts" jsonb NOT NULL,
	"shared_layout_id" uuid,
	"subject" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "templates_salutation_form_check" CHECK ("templates"."salutation_form" in ('du', 'sie'))
);
--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_media" ADD CONSTRAINT "template_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_media" ADD CONSTRAINT "template_media_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_shared_layout_id_layouts_id_fk" FOREIGN KEY ("shared_layout_id") REFERENCES "public"."layouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layouts_name_lower_idx" ON "layouts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "template_media_media_idx" ON "template_media" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_area_name_lower_idx" ON "templates" USING btree ("area_id",lower("name"));--> statement-breakpoint
CREATE INDEX "templates_shared_layout_idx" ON "templates" USING btree ("shared_layout_id");