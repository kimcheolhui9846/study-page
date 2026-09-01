CREATE TABLE "budget_counters" (
	"period_key" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"cap_calls" integer NOT NULL,
	"cap_micros" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day_number" integer NOT NULL,
	"study_date" date NOT NULL,
	"estimated_calls" integer NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "plan_status_valid" CHECK ("daily_plans"."status" IN ('planned','in_progress','completed'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"succeeded" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" bigint NOT NULL,
	"topic_id" text NOT NULL,
	"kind" text NOT NULL,
	"round" integer,
	"minutes" integer NOT NULL,
	"priority" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_no" integer,
	"answers" jsonb,
	"feedback" jsonb,
	"score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_kind_valid" CHECK ("plan_items"."kind" IN ('new','review','remediation')),
	CONSTRAINT "item_status_valid" CHECK ("plan_items"."status" IN ('pending','studying','graded','done','skipped')),
	CONSTRAINT "attempt_cap" CHECK ("plan_items"."attempt_no" IS NULL OR "plan_items"."attempt_no" BETWEEN 1 AND 2),
	CONSTRAINT "item_score_range" CHECK ("plan_items"."score" IS NULL OR "plan_items"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"round" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_round_cap" CHECK ("review_items"."round" BETWEEN 1 AND 4)
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
CREATE TABLE "topic_contents" (
	"topic_id" text PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_micros" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_progress" (
	"topic_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"mastery_score" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"weak_concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_studied_at" timestamp with time zone,
	"next_review_at" date,
	"review_round" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "status_valid" CHECK ("topic_progress"."status" IN ('not_started','learning','weak','reviewing','mastered')),
	CONSTRAINT "score_range" CHECK ("topic_progress"."mastery_score" BETWEEN 0 AND 100),
	CONSTRAINT "review_round_range" CHECK ("topic_progress"."review_round" BETWEEN 0 AND 4)
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
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target_day_count" integer DEFAULT 90 NOT NULL,
	"daily_study_minutes" integer DEFAULT 60 NOT NULL,
	"subject_priority" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_days_sane" CHECK ("users"."target_day_count" BETWEEN 7 AND 730),
	CONSTRAINT "daily_minutes_sane" CHECK ("users"."daily_study_minutes" BETWEEN 10 AND 480)
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_daily_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."daily_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_plan_per_date" ON "daily_plans" USING btree ("study_date");--> statement-breakpoint
CREATE UNIQUE INDEX "one_plan_per_day_number" ON "daily_plans" USING btree ("day_number");--> statement-breakpoint
CREATE INDEX "login_attempts_attempted_at_idx" ON "login_attempts" USING btree ("attempted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_item_per_topic_per_plan" ON "plan_items" USING btree ("plan_id","topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_content_per_round" ON "review_items" USING btree ("topic_id","round");--> statement-breakpoint
CREATE INDEX "topic_progress_next_review_idx" ON "topic_progress" USING btree ("next_review_at");