-- The policy holds for the table's owner too, as for every table of a person's data (0001).
ALTER TABLE "sync_heads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A change to what a conversation is drawn from (docs/sync.md). Only by a handle held to its person: a mailbox removed or a
-- person deleted goes by cascades from the central handle, where nothing is marked; the feed's list of mailboxes says so.
-- The counter row stays locked until the write commits, so a later number never commits before an earlier one.
CREATE FUNCTION sift_mark_conversation(person integer, account text, thread text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  next bigint;
BEGIN
  IF thread IS NULL OR nullif(current_setting('sift.user', true), '') IS DISTINCT FROM person::text THEN
    RETURN;
  END IF;
  INSERT INTO sync_heads (user_id, seq) VALUES (person, 1)
    ON CONFLICT (user_id) DO UPDATE SET seq = sync_heads.seq + 1
    RETURNING seq INTO next;
  INSERT INTO conversation_changes (user_id, account_id, thread_id, seq, changed_at)
    VALUES (person, account, thread, next, (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    ON CONFLICT (user_id, account_id, thread_id) DO UPDATE SET seq = excluded.seq, changed_at = excluded.changed_at;
END $$;--> statement-breakpoint
CREATE FUNCTION sift_thread_of(person integer, account text, message text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT thread_id FROM messages WHERE user_id = person AND account_id = account AND id = message
$$;--> statement-breakpoint
CREATE FUNCTION sift_message_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sift_mark_conversation(OLD.user_id, OLD.account_id, OLD.thread_id);
  ELSE
    PERFORM sift_mark_conversation(NEW.user_id, NEW.account_id, NEW.thread_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
-- Decisions, answers and kept text are marked through their message; one deleted with its message finds none, and the message marks it.
CREATE FUNCTION sift_message_part_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row record;
BEGIN
  IF TG_OP = 'DELETE' THEN row := OLD; ELSE row := NEW; END IF;
  PERFORM sift_mark_conversation(row.user_id, row.account_id, sift_thread_of(row.user_id, row.account_id, row.message_id));
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION sift_feedback_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row record;
  message text;
BEGIN
  IF TG_OP = 'DELETE' THEN row := OLD; ELSE row := NEW; END IF;
  SELECT message_id INTO message FROM decisions WHERE user_id = row.user_id AND id = row.decision_id;
  PERFORM sift_mark_conversation(row.user_id, row.account_id, sift_thread_of(row.user_id, row.account_id, message));
  RETURN NULL;
END $$;--> statement-breakpoint
-- Inbox turned on or off changes which conversations the copy holds without changing any: every cursor before it starts again.
CREATE FUNCTION sift_window_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(current_setting('sift.user', true), '') IS DISTINCT FROM NEW.user_id::text THEN
    RETURN NULL;
  END IF;
  INSERT INTO sync_heads (user_id, seq, purged_through) VALUES (NEW.user_id, 1, 1)
    ON CONFLICT (user_id) DO UPDATE SET seq = sync_heads.seq + 1, purged_through = sync_heads.seq + 1;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER sync_messages_written AFTER INSERT OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION sift_message_changed();--> statement-breakpoint
CREATE TRIGGER sync_messages_changed AFTER UPDATE ON messages FOR EACH ROW
  WHEN (OLD.label_ids IS DISTINCT FROM NEW.label_ids OR OLD.headers IS DISTINCT FROM NEW.headers)
  EXECUTE FUNCTION sift_message_changed();--> statement-breakpoint
CREATE TRIGGER sync_decisions_written AFTER INSERT OR DELETE ON decisions FOR EACH ROW EXECUTE FUNCTION sift_message_part_changed();--> statement-breakpoint
CREATE TRIGGER sync_feedback_written AFTER INSERT OR UPDATE OR DELETE ON feedback FOR EACH ROW EXECUTE FUNCTION sift_feedback_changed();--> statement-breakpoint
CREATE TRIGGER sync_mail_bodies_written AFTER INSERT OR DELETE ON mail_bodies FOR EACH ROW EXECUTE FUNCTION sift_message_part_changed();--> statement-breakpoint
CREATE TRIGGER sync_mail_bodies_previewed AFTER UPDATE ON mail_bodies FOR EACH ROW
  WHEN (OLD.preview IS DISTINCT FROM NEW.preview)
  EXECUTE FUNCTION sift_message_part_changed();--> statement-breakpoint
CREATE TRIGGER sync_window_changed AFTER UPDATE ON preferences FOR EACH ROW
  WHEN (OLD.mail IS DISTINCT FROM NEW.mail)
  EXECUTE FUNCTION sift_window_changed();
