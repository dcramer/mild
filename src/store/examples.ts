import type { DatabaseSync } from 'node:sqlite';
import { MAX_SHOTS, type Shot, excerptOf } from '../triage/fewshot.ts';
import type { MessageFacts } from '../triage/types.ts';

interface ShotRow {
  message_id: string;
  from_address: string;
  from_domain: string;
  from_name: string | null;
  subject: string;
  start: string | null;
  label_id: string;
  marked_at: number;
}

/**
 * Stored examples that might help judge `facts`: the newest from its sender, from its sender's domain,
 * and of each label. More than the prompt takes; `pickShots` chooses among them.
 */
export function shotCandidates(db: DatabaseSync, facts: Pick<MessageFacts, 'accountId' | 'from'>): Shot[] {
  const select = `SELECT e.message_id, m.from_address, m.from_domain, m.from_name, m.subject, substr(e.body_text, 1, 2000) AS start, e.label_id, e.marked_at
     FROM examples e JOIN messages m ON m.account_id = e.account_id AND m.id = e.message_id
     WHERE e.account_id = ? AND e.status = 'captured' AND e.label_id IS NOT NULL`;
  const newest = 'ORDER BY e.marked_at DESC, e.message_id LIMIT ?';
  // One more than the prompt takes, so leaving out the message under judgement still fills it.
  const limit = MAX_SHOTS + 1;
  const rows = [
    ...db.prepare(`${select} AND m.from_address = ? ${newest}`).all(facts.accountId, facts.from.address, limit),
    ...db.prepare(`${select} AND m.from_domain = ? ${newest}`).all(facts.accountId, facts.from.domain, limit),
    ...db
      .prepare(
        `SELECT * FROM (SELECT x.*, row_number() OVER (PARTITION BY label_id ORDER BY marked_at DESC, message_id) AS nth FROM (${select}) x) WHERE nth <= 2`,
      )
      .all(facts.accountId),
  ] as unknown as ShotRow[];
  return [...new Map(rows.map((r) => [r.message_id, r] as const)).values()].map((r) => ({
    messageId: r.message_id,
    fromAddress: r.from_address,
    fromDomain: r.from_domain,
    ...(r.from_name ? { fromName: r.from_name } : {}),
    subject: r.subject,
    excerpt: excerptOf(r.start ?? ''),
    labelId: r.label_id,
    markedAt: r.marked_at,
  }));
}
