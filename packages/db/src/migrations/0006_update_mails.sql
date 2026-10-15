CREATE TABLE "update_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"update_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "update_deliveries_update_id_user_id_unique" UNIQUE("update_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200),
	"content" jsonb NOT NULL,
	"image" "bytea",
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "updates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "updates_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "magic_links" ADD COLUMN "updates_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updates_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" varchar(5) DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "unsubscribe_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "update_deliveries" ADD CONSTRAINT "update_deliveries_update_id_updates_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_deliveries" ADD CONSTRAINT "update_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unsubscribe_token_unique" UNIQUE("unsubscribe_token");