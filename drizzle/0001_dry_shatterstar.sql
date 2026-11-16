CREATE TABLE "ai_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"session_id" bigint,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_request_status_valid" CHECK ("ai_requests"."status" IN ('pending','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "study_materials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"parent_id" bigint,
	"activity" text NOT NULL,
	"content" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"body_md" text NOT NULL,
	"request_id" text,
	"material_id" bigint,
	"problem_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_role_valid" CHECK ("study_messages"."role" IN ('user','assistant')),
	CONSTRAINT "message_kind_valid" CHECK ("study_messages"."kind" IN ('chat','material','feedback','notice'))
);
--> statement-breakpoint
CREATE TABLE "study_problems" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"public" jsonb NOT NULL,
	"private" jsonb NOT NULL,
	"hints_revealed" integer DEFAULT 0 NOT NULL,
	"solution_revealed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hints_revealed_range" CHECK ("study_problems"."hints_revealed" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"study_mode" text NOT NULL,
	"title" text NOT NULL,
	"request" text NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_mode_valid" CHECK ("study_sessions"."study_mode" IN ('english','math','cs','coding')),
	CONSTRAINT "study_status_valid" CHECK ("study_sessions"."status" IN ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "study_submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"problem_id" bigint NOT NULL,
	"attempt_no" integer NOT NULL,
	"answer" text NOT NULL,
	"language" text,
	"feedback_mode" text NOT NULL,
	"feedback" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_attempt_cap" CHECK ("study_submissions"."attempt_no" BETWEEN 1 AND 20),
	CONSTRAINT "feedback_mode_valid" CHECK ("study_submissions"."feedback_mode" IN ('full','errors-only'))
);
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "study_session_id" bigint;--> statement-breakpoint
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_messages" ADD CONSTRAINT "study_messages_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_problems" ADD CONSTRAINT "study_problems_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_problems" ADD CONSTRAINT "study_problems_material_id_study_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."study_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_submissions" ADD CONSTRAINT "study_submissions_problem_id_study_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."study_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_material_per_version" ON "study_materials" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "study_messages_session_idx" ON "study_messages" USING btree ("session_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_problem_per_number" ON "study_problems" USING btree ("session_id","number");--> statement-breakpoint
CREATE INDEX "study_sessions_updated_idx" ON "study_sessions" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_submission_per_attempt" ON "study_submissions" USING btree ("problem_id","attempt_no");