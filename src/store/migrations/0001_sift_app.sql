-- sift's own queries run as sift_app (src/store/sql.ts): it reads and writes every table, owns
-- none, and is held to row-level security. Drizzle cannot say this, so it is written here.
GRANT USAGE ON SCHEMA public TO sift_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sift_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sift_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sift_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sift_app;--> statement-breakpoint
-- The role that migrates may act as sift_app.
GRANT sift_app TO CURRENT_USER;--> statement-breakpoint
-- The policies hold for the tables' owner too.
ALTER TABLE "actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "correspondents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_results" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "examples" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mailboxes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suggestion_bodies" FORCE ROW LEVEL SECURITY;
