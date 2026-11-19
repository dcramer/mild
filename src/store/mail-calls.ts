import type { Confidential } from '../confidential.ts';
import type { MailAnswer } from '../triage/mail-ask.ts';
import type { Usage } from '../triage/stages/model.ts';
import { plain } from '../plain.ts';
import type { SummaryMessage } from '../triage/mail-summary.ts';
import { askName, openEnvelope, openJson, openPart, sealJson, summaryName } from './content.ts';
import { and, asc, eq, inArray, mailAsks, mailBodies, mailSummaries, messages, suggestionBodies } from './query.ts';
import type { Sql } from './sql.ts';

const cost = (usage: Usage | undefined) => (usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : {});

/** Record an Ask before the model is called. */
export async function startAsk(db: Sql, request: { accountId: string; words: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(mailAsks)
    .values({
      accountId: request.accountId,
      startedAt: request.now,
      model: request.model,
      words: sealJson(db, askName(db, request.accountId, 'words'), request.words),
    })
    .returning({ id: mailAsks.id });
  return row!.id;
}

export async function finishAsk(
  db: Sql,
  accountId: string,
  id: number,
  outcome: ({ answer: MailAnswer } | { error: string }) & { usage?: Usage; lookups: number; now: number },
): Promise<void> {
  await db
    .update(mailAsks)
    .set({
      finishedAt: outcome.now,
      lookups: outcome.lookups,
      ...('answer' in outcome ? { answer: sealJson(db, askName(db, accountId, 'answer'), outcome.answer) } : { error: outcome.error }),
      ...cost(outcome.usage),
    })
    .where(eq(mailAsks.id, id));
}

/** Record a Summarize before the model is called, on the conversation as it is now. */
export async function startSummary(db: Sql, request: { accountId: string; threadId: string; newestId: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(mailSummaries)
    .values({ accountId: request.accountId, threadId: request.threadId, newestId: request.newestId, startedAt: request.now, model: request.model })
    .returning({ id: mailSummaries.id });
  return row!.id;
}

export async function finishSummary(
  db: Sql,
  where: { accountId: string; threadId: string },
  id: number,
  outcome: ({ summary: string } | { error: string }) & { usage?: Usage; now: number },
): Promise<void> {
  await db
    .update(mailSummaries)
    .set({
      finishedAt: outcome.now,
      ...('summary' in outcome ? { summary: sealJson(db, summaryName(db, where.accountId, where.threadId), outcome.summary) } : { error: outcome.error }),
      ...cost(outcome.usage),
    })
    .where(eq(mailSummaries.id, id));
}

export interface RecordedSummary {
  newestId: string;
  at: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Null when the call failed, or the text has since been deleted. */
  summary: Confidential | null;
  failed: boolean;
}

/** Every Summarize of a conversation, oldest first. */
export async function summariesOf(db: Sql, accountId: string, threadId: string): Promise<RecordedSummary[]> {
  const rows = await db
    .select()
    .from(mailSummaries)
    .where(and(eq(mailSummaries.accountId, accountId), eq(mailSummaries.threadId, threadId)))
    .orderBy(asc(mailSummaries.startedAt), asc(mailSummaries.id));
  return rows.map((r) => ({
    newestId: r.newestId,
    at: r.finishedAt ?? r.startedAt,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    summary: r.summary === null ? null : openJson<string>(db, summaryName(db, accountId, threadId), r.summary),
    failed: r.error !== null,
  }));
}

/**
 * A conversation's recorded messages, oldest first, as the model is shown them: who sent each and its text, from
 * Inbox's copy or else the copy kept while it waits on the reader. Null when Sift has none of it.
 */
export async function conversationText(
  db: Sql,
  accountId: string,
  threadId: string,
): Promise<{ subject: string; newestId: string; messages: SummaryMessage[] } | null> {
  const rows = await db
    .select({ id: messages.id, headers: messages.headers, receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, threadId)))
    .orderBy(asc(messages.receivedAt), asc(messages.id));
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.id);
  const texts = new Map<string, string>();
  // Inbox's copy is read last, so it wins: it is all of the text.
  for (const table of [suggestionBodies, mailBodies]) {
    const bodies = await db
      .select({ messageId: table.messageId, text: table.bodyText })
      .from(table)
      .where(and(eq(table.accountId, accountId), inArray(table.messageId, ids)));
    for (const b of bodies) texts.set(b.messageId, plain(openPart(db, accountId, b.messageId, 'text', b.text)) ?? '');
  }
  const opened = rows.map((r) => ({ ...r, ...openEnvelope(db, accountId, r.id, { headers: r.headers }) }));
  const newest = opened.at(-1)!;
  return {
    subject: plain(newest.subject),
    newestId: newest.id,
    messages: opened.map((m) => ({
      from: plain(m.fromName) ? `${plain(m.fromName)} <${plain(m.fromAddress)}>` : plain(m.fromAddress),
      receivedAt: m.receivedAt,
      text: texts.get(m.id) ?? '',
    })),
  };
}
