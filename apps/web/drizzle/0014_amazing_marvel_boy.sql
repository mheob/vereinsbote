CREATE TABLE "send_scope_pauses" (
	"code" text NOT NULL,
	"paused_until" timestamp with time zone NOT NULL,
	"scope" text PRIMARY KEY NOT NULL
);
