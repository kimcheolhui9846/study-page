CREATE TABLE "attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"study_day_id" bigint NOT NULL,
	"attempt_no" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"feedback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_cap" CHECK ("attempts"."attempt_no" BETWEEN 1 AND 2)
);
--> statement-breakpoint
CREATE TABLE "budget_counters" (
	"period_key" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"cap_calls" integer NOT NULL,
	"cap_micros" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"succeeded" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"day_no" integer NOT NULL,
	"study_date" date NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"content" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "status_valid" CHECK ("study_days"."status" IN ('in_progress','completed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"study_day_id" bigint PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"polished_text" text,
	"polished_at" timestamp with time zone,
	"polish_count" integer DEFAULT 0 NOT NULL,
	"velog_url" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polish_cap" CHECK ("summaries"."polish_count" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"route" text NOT NULL,
	"subject" text,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_micros" bigint,
	"ok" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_study_day_id_study_days_id_fk" FOREIGN KEY ("study_day_id") REFERENCES "public"."study_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_study_day_id_study_days_id_fk" FOREIGN KEY ("study_day_id") REFERENCES "public"."study_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_attempt_no_per_day" ON "attempts" USING btree ("study_day_id","attempt_no");--> statement-breakpoint
CREATE INDEX "login_attempts_attempted_at_idx" ON "login_attempts" USING btree ("attempted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_row_per_day" ON "study_days" USING btree ("subject","day_no");--> statement-breakpoint
CREATE UNIQUE INDEX "one_day_per_date" ON "study_days" USING btree ("subject","study_date");