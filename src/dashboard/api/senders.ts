import { z } from 'zod';
import { listAccounts } from '../../store/accounts.ts';
import { standingRule } from '../../store/rules.ts';
import { removeRuleAndFilter } from './rules.ts';
import { senderPage } from '../queries/senders.ts';
import { SenderPage } from '../types.ts';
import { type Read, type Write, accountId, done, missing, named, ok, read, text, write } from './route.ts';

const SHARED = 'Anyone can get an address at that domain, so it has no standing of its own.';
const lower = z
  .string()
  .default('')
  .transform((value) => value.toLowerCase());

export const reads: Read[] = [
  read({
    path: '/api/sender',
    query: z.object({ account: z.string().default(''), address: lower }),
    reply: SenderPage,
    run: async ({ db, now }, scope, { account, address }) => {
      const page = await senderPage(db, scope, account, { address }, now());
      return page ? ok(page) : missing(SHARED);
    },
  }),
  read({
    path: '/api/domain',
    query: z.object({ account: z.string().default(''), domain: lower }),
    reply: SenderPage,
    run: async ({ db, now }, scope, { account, domain }) => {
      const page = await senderPage(db, scope, account, { domain }, now());
      return page ? ok(page) : missing(SHARED);
    },
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/standing/clear',
    body: z
      .strictObject({
        accountId,
        address: text()
          .regex(/^[^@\s]+@[^@\s]+$/)
          .optional(),
        domain: text()
          .regex(/^[^@\s]+$/)
          .optional(),
      })
      .refine((who) => (who.address === undefined) !== (who.domain === undefined), { message: 'Name an address or a domain, and not both.' }),
    reply: done,
    touches: named,
    run: async (ctx, { accountId, address, domain }) => {
      if (!(await listAccounts(ctx.db)).some((a) => a.id === accountId)) return null;
      const id = await standingRule(ctx.db, accountId, address === undefined ? { fromDomain: domain!.toLowerCase() } : { from: address.toLowerCase() });
      if (id) await removeRuleAndFilter(ctx, id);
      return { ok: true as const };
    },
  }),
];
