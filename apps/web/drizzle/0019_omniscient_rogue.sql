ALTER TABLE "attachments" DROP CONSTRAINT "attachments_occasion_id_occasions_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "occasion_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE set null ON UPDATE no action;