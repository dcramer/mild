import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildPage } from '../src/cli/next.ts';
import { HELD, SEED, TEMPLATES, type Variant } from './fixture.ts';
import { loadConfig } from '../src/config.ts';
import { plain } from '../src/plain.ts';
import { listAccounts } from '../src/store/accounts.ts';
import { openEnvelope, openPart } from '../src/store/content.ts';
import { people } from '../src/store/people.ts';
import { listProposals } from '../src/store/proposals.ts';
import { decisions, messages, readBodies } from '../src/store/query.ts';
import { listRules } from '../src/store/rules.ts';
import { openStore } from '../src/store/store.ts';

/**
 * What the seeded home's owner has stored encrypted, decrypted through the store: every sender, recipient, subject,
 * line of waiting mail, decision's reason and rule's or proposal's condition and name. Their own mailboxes'
 * addresses are stored plain, and are left out.
 */
async function heldValues(home: string): Promise<string[]> {
  const store = await openStore(loadConfig({ MILD_HOME: home }));
  try {
    const owner = (await people(store).owner())!;
    const db = await owner.open(owner.id);
    const held = new Set<string>();
    const add = (...values: (string | null | undefined)[]) => values.forEach((v) => v && held.add(v));
    for (const row of await db.select({ accountId: messages.accountId, id: messages.id, headers: messages.headers }).from(messages)) {
      const m = plain(openEnvelope(db, row.accountId, row.id, { headers: row.headers }));
      add(m.subject, m.fromAddress, m.fromName, ...[...m.to, ...m.cc].flatMap((a) => [a.address, a.name]));
    }
    for (const row of await db.select().from(readBodies))
      add(
        plain(openPart(db, row.accountId, row.messageId, 'text', row.bodyText))
          ?.trim()
          .split('\n')[0]
          ?.slice(0, 60),
      );
    for (const row of await db.select({ accountId: decisions.accountId, messageId: decisions.messageId, reason: decisions.reason }).from(decisions))
      add(plain(openPart(db, row.accountId, row.messageId, 'reason', row.reason)));
    const conditions = [...(await listRules(db)).flatMap((r) => [r.match, ...(r.except ?? [])]), ...(await listProposals(db)).map((p) => plain(p.match))];
    for (const match of conditions) add(...Object.entries(match).flatMap(([key, value]) => (key === 'facts' ? [] : (value as string[]))));
    add(...(await listRules(db)).map((r) => r.name));
    for (const account of await listAccounts(db)) held.delete(account.email);
    return [...held].filter((value) => value.length >= 4);
  } finally {
    await store.close();
  }
}

/**
 * Builds the page once (Next.js's cache keeps that to seconds when little changed), and seeds each variant once through verify-sift's real passes (several seconds each);
 * every test then starts from a copy of one.
 */
export default async function setup() {
  await buildPage();
  const root = mkdtempSync(join(tmpdir(), 'sift-e2e-'));
  const variants: Record<Variant, string[]> = { full: [], bare: ['--bare'], on: ['--on'], chatgpt: ['--chatgpt'], inbox: ['--inbox'] };
  await Promise.all(
    Object.entries(variants).map(async ([name, args]) => {
      const dir = join(root, name);
      const { stdout } = await promisify(execFile)('node', [
        '--disable-warning=ExperimentalWarning',
        SEED,
        join(dir, 'home'),
        join(dir, 'google.json'),
        ...args,
      ]);
      process.env[`${TEMPLATES}_${name}`] = JSON.stringify({ dir, cookie: stdout.trim() });
    }),
  );
  process.env[HELD] = JSON.stringify(await heldValues(join(root, 'full', 'home')));
  return () => rmSync(root, { recursive: true, force: true });
}
