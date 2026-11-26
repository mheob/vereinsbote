CREATE TABLE "test_mail_claims" (
	"at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occasion_id" uuid,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_mail_claims" ADD CONSTRAINT "test_mail_claims_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_mail_claims" ADD CONSTRAINT "test_mail_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_mail_claims_user_idx" ON "test_mail_claims" USING btree ("user_id","at");