import type { Sql } from './sql.ts';

/**
 * A person's guidelines until they write their own. The model reads all of it as their instructions, so
 * it holds only instructions: they name the default labels (src/store/labels.ts) and lean towards
 * leaving mail in the inbox.
 */
export const DEFAULT_GUIDELINES = `# Guidelines for sift

- When in doubt, keep it in my inbox. If you are not sure what a message is, say you are unsure. I would rather read one message too many than miss one that mattered.
- Anything a person wrote to me, or to a small group I am part of, is Personal, however short or oddly written. So is a reply in a conversation I took part in.
- Anything about my money, my accounts or something I have to do by a date stays in my inbox: bills, renewals, failed payments, deliveries, bookings, tax, legal and security notices. A company's receipts are not Marketing because its promotions are.
- Marketing and Newsletters are only for mail sent to a whole list. Mail from a company about me in particular (my order, my account, my support request) is neither.
- Cold outreach is a pitch from someone I have no history with. If I have written to them, or they are answering me, it is Personal.
- A real notice about my own account is Security and account, however alarming. It is Phishing only when the sender is not who they claim to be.
- Junk is for mail that is deceptive or that I could never have signed up for. Unwanted mail from a real company is Marketing.
`;

export interface Preferences {
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
  guidelines: string;
  /** When they last changed their guidelines, or null if they never have. */
  guidelinesChangedAt: number | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const row = (await db.get<{ model: string | null; guidelines: string | null; guidelines_changed_at: number | null }>(
    'SELECT model, guidelines, guidelines_changed_at FROM preferences',
  ))!;
  return { model: row.model, guidelines: row.guidelines ?? DEFAULT_GUIDELINES, guidelinesChangedAt: row.guidelines_changed_at };
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.run('UPDATE preferences SET model = ?', model);
}

/** Saving the same text again changes nothing, so it does not make every waiting suggestion look out of date. */
export async function setGuidelines(db: Sql, text: string, now: number = Date.now()): Promise<void> {
  if ((await preferences(db)).guidelines === text) return;
  await db.run('UPDATE preferences SET guidelines = ?, guidelines_changed_at = ?', text, now);
}
