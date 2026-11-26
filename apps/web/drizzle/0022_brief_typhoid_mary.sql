CREATE TABLE "processed_reports" (
	"connection_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_id" text NOT NULL,
	CONSTRAINT "processed_reports_connection_id_report_id_pk" PRIMARY KEY("connection_id","report_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_reports" ADD CONSTRAINT "processed_reports_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_bounces_entry_idx" ON "contact_bounces" USING btree ("entry_id");