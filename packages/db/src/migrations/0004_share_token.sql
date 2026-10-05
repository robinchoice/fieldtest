ALTER TABLE "rounds" ADD COLUMN "share_token" varchar(64);--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_share_token_unique" UNIQUE("share_token");