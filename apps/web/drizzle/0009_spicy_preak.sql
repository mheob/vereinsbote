ALTER TABLE "custom_fields" ADD COLUMN "placeholder_key" text;--> statement-breakpoint
WITH "slugs" AS (
	SELECT
		"id",
		"kind",
		"created_at",
		regexp_replace(
			replace(replace(replace(replace(replace(replace(replace(lower("name"), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
			'[^a-z0-9]',
			'',
			'g'
		) AS "slug"
	FROM "custom_fields"
),
"bases" AS (
	SELECT
		"id",
		"kind",
		"created_at",
		CASE WHEN "slug" = '' OR "slug" ~ '^[0-9]' THEN 'field' || "slug" ELSE "slug" END AS "base"
	FROM "slugs"
),
"numbered" AS (
	SELECT
		"id",
		"base",
		row_number() OVER (PARTITION BY "kind", "base" ORDER BY "created_at", "id") AS "position"
	FROM "bases"
)
UPDATE "custom_fields"
SET "placeholder_key" = CASE WHEN "numbered"."position" = 1 THEN "numbered"."base" ELSE "numbered"."base" || "numbered"."position" END
FROM "numbered"
WHERE "custom_fields"."id" = "numbered"."id";--> statement-breakpoint
ALTER TABLE "custom_fields" ALTER COLUMN "placeholder_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_kind_placeholder_key_idx" ON "custom_fields" USING btree ("kind","placeholder_key");
