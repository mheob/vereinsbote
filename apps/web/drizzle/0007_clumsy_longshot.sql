CREATE TABLE "contact_opt_outs" (
	"area_id" uuid,
	"contact_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"occasion_id" uuid,
	"scope" text NOT NULL,
	CONSTRAINT "contact_opt_outs_kind_check" CHECK ("contact_opt_outs"."kind" in ('member', 'partner')),
	CONSTRAINT "contact_opt_outs_scope_check" CHECK ("contact_opt_outs"."scope" in ('area', 'occasion')),
	CONSTRAINT "contact_opt_outs_target_check" CHECK (("contact_opt_outs"."scope" = 'area') = ("contact_opt_outs"."area_id" is not null and "contact_opt_outs"."occasion_id" is null))
);
--> statement-breakpoint
CREATE TABLE "contact_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"members_area_id" uuid,
	"partners_area_id" uuid,
	"stale_import_weeks" integer DEFAULT 8 NOT NULL,
	CONSTRAINT "contact_settings_singleton_check" CHECK ("contact_settings"."id"),
	CONSTRAINT "contact_settings_stale_import_weeks_check" CHECK ("contact_settings"."stale_import_weeks" between 1 and 52)
);
--> statement-breakpoint
CREATE TABLE "contact_suppressions" (
	"contact_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"kind" text NOT NULL,
	CONSTRAINT "contact_suppressions_kind_contact_key_pk" PRIMARY KEY("kind","contact_key"),
	CONSTRAINT "contact_suppressions_kind_check" CHECK ("contact_suppressions"."kind" in ('member', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"birth_date" date,
	"city" text,
	"contact_key" text GENERATED ALWAYS AS (case when kind = 'member' then 'nr:' || member_number when customer_number is not null then 'nr:' || customer_number else 'email:' || email end) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_number" text,
	"custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email" text,
	"entry_date" date,
	"exit_date" date,
	"first_name" text,
	"gender" text DEFAULT 'unspecified' NOT NULL,
	"groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"last_name" text,
	"member_number" text,
	"organization" text,
	"postal_code" text,
	"street" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_kind_check" CHECK ("contacts"."kind" in ('member', 'partner')),
	CONSTRAINT "contacts_gender_check" CHECK ("contacts"."gender" in ('female', 'male', 'diverse', 'unspecified')),
	CONSTRAINT "contacts_member_number_check" CHECK (("contacts"."kind" = 'member') = ("contacts"."member_number" is not null)),
	CONSTRAINT "contacts_customer_number_check" CHECK ("contacts"."kind" = 'partner' or "contacts"."customer_number" is null),
	CONSTRAINT "contacts_partner_identity_check" CHECK ("contacts"."kind" = 'member' or "contacts"."customer_number" is not null or "contacts"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"protection" text DEFAULT 'protected' NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "custom_fields_kind_check" CHECK ("custom_fields"."kind" in ('member', 'partner')),
	CONSTRAINT "custom_fields_type_check" CHECK ("custom_fields"."type" in ('text', 'date')),
	CONSTRAINT "custom_fields_protection_check" CHECK ("custom_fields"."protection" in ('base', 'protected'))
);
--> statement-breakpoint
CREATE TABLE "import_state" (
	"kind" text PRIMARY KEY NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"mapping" jsonb,
	"stock_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "import_state_kind_check" CHECK ("import_state"."kind" in ('member', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "protected_field_areas" (
	"area_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "protected_field_areas_kind_field_key_area_id_pk" PRIMARY KEY("kind","field_key","area_id"),
	CONSTRAINT "protected_field_areas_kind_check" CHECK ("protected_field_areas"."kind" in ('member', 'partner'))
);
--> statement-breakpoint
ALTER TABLE "contact_opt_outs" ADD CONSTRAINT "contact_opt_outs_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_opt_outs" ADD CONSTRAINT "contact_opt_outs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD CONSTRAINT "contact_settings_members_area_id_areas_id_fk" FOREIGN KEY ("members_area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD CONSTRAINT "contact_settings_partners_area_id_areas_id_fk" FOREIGN KEY ("partners_area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_field_areas" ADD CONSTRAINT "protected_field_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_opt_outs_area_idx" ON "contact_opt_outs" USING btree ("kind","contact_key","area_id") WHERE "contact_opt_outs"."scope" = 'area';--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_member_number_idx" ON "contacts" USING btree ("member_number") WHERE "contacts"."kind" = 'member';--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_customer_number_idx" ON "contacts" USING btree ("customer_number") WHERE "contacts"."customer_number" is not null;--> statement-breakpoint
CREATE INDEX "contacts_kind_key_idx" ON "contacts" USING btree ("kind","contact_key");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_kind_name_idx" ON "custom_fields" USING btree ("kind",lower("name"));