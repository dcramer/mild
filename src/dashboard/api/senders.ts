import { listAccounts } from '../../store/accounts.ts';
import { setStanding } from '../../store/rules.ts';
import { senderPage } from '../queries.ts';
import { type Read, type Write, missing, named, ok, str } from './route.ts';

const SHARED = 'Anyone can get an address at that domain, so it has no standing of its own.';

export const reads: Read[] = [
  {
    path: '/api/sender',
    run: ({ db, now }, scope, query) => {
      const page = senderPage(db, scope, query.get('account') ?? '', { address: (query.get('address') ?? '').toLowerCase() }, now());
      return page ? ok(page) : missing(SHARED);
    },
  },
  {
    path: '/api/domain',
    run: ({ db, now }, scope, query) => {
      const page = senderPage(db, scope, query.get('account') ?? '', { domain: (query.get('domain') ?? '').toLowerCase() }, now());
      return page ? ok(page) : missing(SHARED);
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/standing',
    touches: named,
    run: ({ db, now }, body) => {
      const { accountId, address, domain, standing } = body;
      if (!str(accountId) || (standing !== 'trusted' && standing !== 'unwanted' && standing !== 'blocked' && standing !== 'none')) return null;
      // Exactly one of the two, and an address must look like one.
      if ((address === undefined) === (domain === undefined)) return null;
      if (address !== undefined && (!str(address) || !/^[^@\s]+@[^@\s]+$/.test(address))) return null;
      if (domain !== undefined && (!str(domain) || /[@\s]/.test(domain))) return null;
      if (!listAccounts(db).some((a) => a.id === accountId)) return null;
      const who = typeof address === 'string' ? address.toLowerCase() : (domain as string).toLowerCase();
      setStanding(db, accountId, typeof address === 'string' ? { from: who } : { fromDomain: who }, standing, now());
      return { ok: true };
    },
  },
];
