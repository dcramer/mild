import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq, exists, inArray, is } from 'drizzle-orm';
import { PgTable, alias, getTableConfig } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { pglite } from '../src/store/db.ts';
import { sql } from '../src/store/own.ts';
import * as schema from '../src/store/schema.ts';
import { decisions, labels, messages, rules, users } from '../src/store/schema.ts';
import { type Driver, type Sql, handle } from '../src/store/sql.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { freshStore, raw, superuser } from './fixtures.ts';
import { facts } from './helpers.ts';
import type { Disposition } from '../src/triage/types.ts';
import { loadKeyring } from '../src/secrets.ts';

/*
 * The builder's own hold on each person, with row-level security out of the way: these handles never
 * become sift_app, so as the superuser the database itself would show and change anyone's rows.
 */
const unguarded = async (): Promise<Driver> => {
  const driver = pglite(await superuser());
  return {
    ...driver,
    transaction: (work) =>
      driver.transaction((c) =>
        work({ ...c, query: async (text, params, array) => (text.startsWith('SET LOCAL ROLE') ? { rows: [], count: 0 } : await c.query(text, params, array)) }),
      ),
  };
};

const ALPHA = 'alpha@example.org';
const BRAVO = 'bravo@example.net';
let alpha: Sql;
let bravo: Sql;
let central: Sql;
const everyone = async (table: string) => (await (await superuser()).query<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY user_id`)).rows;

beforeEach(async () => {
  const store = await freshStore();
  for (const [account, id] of [
    [ALPHA, 'a'],
    [BRAVO, 'b'],
  ] as const) {
    const person = await connectAccount(store, account, '1', 0);
    const db = await store.user(person);
    await recordSync(db, account, [facts({ accountId: account, messageId: `m-${id}`, subject: `Subject ${id}` })], '2', 1);
    await recordDecision(db, account, `m-${id}`, { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: id });
    await raw(db).run(
      `INSERT INTO rules (id, account_id, position, match, label_id, source, created_at) VALUES (?, ?, 0, '{}', 'personal', 'user', 0)`,
      `rule-${id}`,
      account,
    );
  }
  const driver = await unguarded();
  [alpha, bravo, central] = [handle(driver, 1, loadKeyring({})), handle(driver, 2, loadKeyring({})), handle(driver, null, loadKeyring({}))];
});

describe("a person's handle, without row-level security", () => {
  it('reads only their rows, whatever the where says', async () => {
    expect((await alpha.select({ id: messages.id }).from(messages)).map((r) => r.id)).toEqual(['m-a']);
    expect(await alpha.select({ id: messages.id }).from(messages).where(eq(messages.id, 'm-b'))).toEqual([]);
    expect(await bravo.selectDistinct({ subject: messages.subject }).from(messages)).toEqual([{ subject: 'sift-plain:Subject b' }]);
    expect(await alpha.select({ id: users.id }).from(users)).toEqual([{ id: 1 }]);
  });

  it('joins only their rows, through an alias too', async () => {
    const d = alias(decisions, 'd');
    // A join on a condition that would match anyone's.
    const rows = await alpha
      .select({ message: messages.id, reason: d.reason })
      .from(messages)
      .leftJoin(d, sql`true`);
    expect(rows).toEqual([{ message: 'm-a', reason: 'a' }]);
    const inner = await alpha.select({ reason: decisions.reason }).from(messages).innerJoin(decisions, eq(decisions.messageId, messages.id));
    expect(inner).toEqual([{ reason: 'a' }]);
    // A where after a join keeps the person's hold on the table it selects from.
    const after = await alpha
      .select({ message: messages.id })
      .from(messages)
      .leftJoin(decisions, sql`true`)
      .orderBy(messages.id)
      .where(sql`true`);
    expect(after).toEqual([{ message: 'm-a' }]);
    const twice = alias(decisions, 'twice');
    const second = await alpha
      .select({ reason: twice.reason })
      .from(messages)
      .leftJoin(d, sql`true`)
      .leftJoin(twice, sql`true`);
    expect(second).toEqual([{ reason: 'a' }]);
    const updated = await alpha
      .update(rules)
      .set({ hits: 3 })
      .returning({ id: rules.id })
      .where(sql`true`);
    expect(updated).toEqual([{ id: 'rule-a' }]);
    expect(() =>
      alpha
        .select()
        .from(messages)
        .rightJoin(decisions, sql`true`),
    ).toThrow('left or inner join');
  });

  it('refuses a second table in a change, which its where would not hold', () => {
    expect(() => alpha.update(rules).set({ hits: 1 }).from(decisions)).toThrow('from is not held to one person');
    const remove = alpha.delete(rules) as unknown as { using: (table: unknown) => unknown };
    expect(() => remove.using(decisions)).toThrow('using is not held to one person');
  });

  it('holds a subquery to them as well', async () => {
    const theirs = alpha.select({ id: decisions.messageId }).from(decisions);
    expect(await bravo.select({ id: messages.id }).from(messages).where(inArray(messages.id, theirs))).toEqual([]);
    const any = bravo.select({ one: sql`1` }).from(decisions);
    expect(await alpha.select({ id: messages.id }).from(messages).where(exists(any))).toEqual([{ id: 'm-a' }]);
  });

  it('changes and deletes only their rows', async () => {
    expect(await alpha.update(rules).set({ hits: 5 }).returning({ id: rules.id })).toHaveLength(1);
    await alpha
      .update(rules)
      .set({ position: 9 })
      .where(inArray(rules.id, ['rule-a', 'rule-b']));
    await alpha.delete(decisions);
    expect((await everyone('rules')).map((r) => [r['user_id'], r['hits'], r['position']])).toEqual([
      [1, 5, 9],
      [2, 0, 0],
    ]);
    expect((await everyone('decisions')).map((r) => r['user_id'])).toEqual([2]);
  });

  it('writes their id on every row it adds, and never lets anyone set it', async () => {
    await alpha
      .insert(labels)
      .values({ accountId: ALPHA, id: 'l', name: 'L', description: '', disposition: 'keep', gmailLabel: 'sift/l', position: 0, updatedAt: 0 });
    // Each mailbox starts with the default labels; the one added here is the only 'l'.
    expect((await everyone('labels')).filter((r) => r['id'] === 'l').map((r) => r['user_id'])).toEqual([1]);
    const forged = {
      accountId: BRAVO,
      id: 'l',
      name: 'L',
      description: '',
      disposition: 'keep' as const,
      gmailLabel: 'sift/l',
      position: 0,
      updatedAt: 0,
      userId: 2,
    };
    expect(() => alpha.insert(labels).values(forged)).toThrow("user_id is the handle's to set");
    expect(() => alpha.update(labels).set({ userId: 2 })).toThrow("user_id is the handle's to set");
  });

  it('never updates the row of someone whose key it collides with', async () => {
    const theirs = (await everyone('decisions')).find((r) => r['user_id'] === 2)!['id'] as number;
    await alpha
      .insert(decisions)
      .values({ id: theirs, accountId: ALPHA, messageId: 'm-a', stage: 'fallback', disposition: 'review', subscription: 'preserve', reason: 'x', decidedAt: 0 })
      .onConflictDoUpdate({ target: decisions.id, set: { reason: 'taken' } });
    expect((await everyone('decisions')).map((r) => r['reason'])).toEqual(['a', 'b']);
  });

  it('runs the builder inside a transaction, all or nothing', async () => {
    await expect(
      alpha.transaction(async (tx) => {
        await tx.delete(rules);
        throw new Error('changed my mind');
      }),
    ).rejects.toThrow('changed my mind');
    expect(await everyone('rules')).toHaveLength(2);
    await alpha.transaction(
      async (tx) =>
        await tx
          .update(rules)
          .set({ hits: 1 })
          .where(inArray(rules.id, ['rule-a', 'rule-b'])),
    );
    expect((await everyone('rules')).map((r) => r['hits'])).toEqual([1, 0]);
  });
});

describe('a failed statement', () => {
  it('reports what the database said, not the values it was given', async () => {
    const values = {
      id: 'l',
      accountId: ALPHA,
      name: 'L',
      description: 'private words',
      disposition: 'nonsense' as Disposition,
      gmailLabel: 'sift/l',
      position: 0,
      updatedAt: 0,
    };
    const error = await alpha
      .insert(labels)
      .values(values)
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toContain('labels_disposition');
    expect(error?.message).not.toContain('private words');
    const conflict = await alpha
      .insert(labels)
      .values(values)
      .onConflictDoUpdate({ target: [labels.userId, labels.accountId, labels.id], set: { description: 'private words' } })
      .catch((e: unknown) => e as Error);
    expect((conflict as Error).message).not.toContain('private words');
    await expect(
      alpha
        .select()
        .from(messages)
        .where(sql`nonsense`),
    ).rejects.toThrow('column "nonsense" does not exist');
  });
});

describe('the central handle', () => {
  it('reads who the people are but never anyone’s data', async () => {
    expect(await central.select({ id: users.id }).from(users)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(() => central.select().from(messages)).toThrow("central handle sees no one's data");
    expect(() => central.delete(rules)).toThrow("central handle sees no one's data");
  });
});

describe('raw sql', () => {
  it('refuses a person’s table written into it', () => {
    expect(() => sql`SELECT * FROM ${messages}`).toThrow('not held to one person');
    expect(() => sql`SELECT * FROM ${[sql`x`, [alias(messages, 'm')]]}`).toThrow('messages written into');
    expect(() => sql`${messages.id} = 'x'`).not.toThrow();
  });

  it('has no helper that writes SQL text or names unchecked', () => {
    for (const helper of ['raw', 'identifier', 'join', 'fromList']) expect(sql, helper).not.toHaveProperty(helper);
  });
});

/** The text of every string and template literal in TypeScript source, comments left out. */
function literals(source: string): string[] {
  const found: string[] = [];
  // How many braces deep each template's `${` is, innermost last.
  const templates: number[] = [];
  let depth = 0;
  let last = '';
  const template = (from: number): number => {
    let text = '';
    let i = from;
    for (; i < source.length && source[i] !== '`'; i++) {
      if (source[i] === '\\') text += source[i++]! + (source[i] ?? '');
      else if (source[i] === '$' && source[i + 1] === '{') {
        templates.push(depth++);
        found.push(text);
        return i + 1;
      } else text += source[i];
    }
    found.push(text);
    return i;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
    else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i + 2) + 1;
    else if (c === "'" || c === '"') {
      let text = '';
      for (i++; i < source.length && source[i] !== c; i++) text += source[i] === '\\' ? source[i++]! + source[i] : source[i];
      found.push(text);
    } else if (c === '`') i = template(i + 1);
    else if (c === '}' && templates.at(-1) === depth - 1) {
      templates.pop();
      depth--;
      i = template(i + 1);
    } else if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(?:return|typeof|case|in|of|throw|yield|await)$/.test(last))) {
      // A regular expression, not a division.
      let inClass = false;
      for (i++; i < source.length && (source[i] !== '/' || inClass); i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
      }
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    if (!/\s/.test(c)) last = /[\w$]/.test(c) ? `${/[\w$]$/.test(last) ? last : ''}${c}` : c;
  }
  return found;
}

describe('the source', () => {
  it('names no table in SQL text: every query is built, so the handle can hold it to one person', () => {
    const names = Object.values(schema as Record<string, unknown>)
      .filter((t) => is(t, PgTable))
      .map((t) => getTableConfig(t).name);
    const inSql = new RegExp(`\\b(?:from|join|into|update|using)\\s+"?(?:${names.join('|')})"?\\b`, 'i');
    const found: string[] = [];
    for (const file of readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join('src', file), 'utf8');
      for (const literal of literals(text)) if (inSql.test(literal)) found.push(`src/${file}: ${literal.slice(0, 60)}`);
      // Drizzle's own, for CHECK constraints built from constants when the schema is generated.
      if (file !== join('store', 'schema.ts'))
        for (const m of text.matchAll(/\bsql\s*\.\s*(?:raw|identifier|join|fromList)\b/g))
          found.push(`src/${file}:${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it('reads string and template text, whatever its case, and not comments', () => {
    const source = [
      "const a = 'select * from Messages'; // from rules",
      'const b = sql`x ${y ? `in ${"Update Labels"}` : 1} z`;',
      '/* into users */ const c = /from decisions/.test(d) ? e / f : g / h;',
    ].join('\n');
    expect(literals(source)).toEqual(['select * from Messages', 'x ', 'in ', 'Update Labels', '', ' z']);
  });
});
