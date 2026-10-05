CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"tester_id" uuid NOT NULL,
	"session_id" uuid,
	"finding_id" uuid,
	"kind" varchar(20) NOT NULL,
	"base_sats" integer NOT NULL,
	"multiplier" integer DEFAULT 100 NOT NULL,
	"amount_sats" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"approve_at" timestamp,
	"invoice" text,
	"payment_hash" varchar(64),
	"preimage" varchar(64),
	"last_error" varchar(500),
	"approved_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"label" varchar(300) NOT NULL,
	"screen" varchar(200) NOT NULL,
	"sats" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"finding_id" uuid,
	"type" varchar(20) NOT NULL,
	"text" text NOT NULL,
	"anchor_label" varchar(300) NOT NULL,
	"anchor_screen" varchar(200) NOT NULL,
	"auto" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"severity" varchar(20),
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"title" varchar(300) NOT NULL,
	"screen" varchar(200) NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"fix" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"product" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"prototype_url" varchar(2000) NOT NULL,
	"goals" jsonb NOT NULL,
	"rewards" jsonb NOT NULL,
	"planned_sessions" integer DEFAULT 20 NOT NULL,
	"invite_token" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rounds_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"budget_sats" integer,
	"host" varchar(200),
	"version" varchar(40),
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "runners_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "runners_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "test_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"tester_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"live_sats" integer DEFAULT 0 NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "testers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lightning_address" varchar(320) NOT NULL,
	"reputation" integer DEFAULT 50 NOT NULL,
	"approved_sessions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "testers_lightning_address_unique" UNIQUE("lightning_address")
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tester_id_testers_id_fk" FOREIGN KEY ("tester_id") REFERENCES "public"."testers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_tester_id_testers_id_fk" FOREIGN KEY ("tester_id") REFERENCES "public"."testers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_round_idx" ON "claims" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "feedback_finding_idx" ON "feedback" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "findings_round_idx" ON "findings" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "test_sessions_round_idx" ON "test_sessions" USING btree ("round_id");