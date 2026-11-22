-- The policy holds for the table's owner too, as for every table of a person's data (0001).
ALTER TABLE "addresses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_pieces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Every mailbox there is has mail recorded before the address book: the pass adds it from the start (`fillAddresses`).
ALTER TABLE "mailboxes" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "mailboxes" SET "addresses_from" = '';--> statement-breakpoint
ALTER TABLE "mailboxes" FORCE ROW LEVEL SECURITY;
