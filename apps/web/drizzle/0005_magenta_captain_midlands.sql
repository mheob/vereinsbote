CREATE TABLE "area_memberships" (
	"area_id" uuid NOT NULL,
	"level" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "area_memberships_user_id_area_id_pk" PRIMARY KEY("user_id","area_id"),
	CONSTRAINT "area_memberships_level_check" CHECK ("area_memberships"."level" in ('read', 'edit', 'send'))
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"action" text NOT NULL,
	"actor_user_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb,
	"id" bigserial PRIMARY KEY NOT NULL,
	"target" text
);
--> statement-breakpoint
ALTER TABLE "area_memberships" ADD CONSTRAINT "area_memberships_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_memberships" ADD CONSTRAINT "area_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_name_lower_idx" ON "areas" USING btree (lower("name"));