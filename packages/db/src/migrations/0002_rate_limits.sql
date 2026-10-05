CREATE TABLE "rate_limits" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp NOT NULL
);
