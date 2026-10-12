CREATE TABLE "evaluation_jobs" (
	"feedback_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_jobs" ADD CONSTRAINT "evaluation_jobs_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;