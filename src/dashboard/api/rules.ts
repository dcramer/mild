import { getRuleFilter, ruleFilterStatus } from '../../store/filters.ts';
import { addRule, removeRule } from '../../store/rules.ts';
import { listRuleSummaries } from '../queries/rules.ts';
import { LABEL_ID, RULE_KEYS, type Read, type Write, decided, named, ok, ownerOf, redecide, str } from './route.ts';

export const reads: Read[] = [{ path: '/api/rules', run: async ({ db }, scope) => ok({ rules: await listRuleSummaries(db, scope) }) }];

export const writes: Write[] = [
  {
    path: '/api/rules',
    touches: named,
    run: async ({ db, now }, body) => {
      const { accountId, match, label, whenLabel, disposition, markRead, unsubscribe, when } = body;
      if (when !== undefined && (typeof when !== 'string' || when.length > 200)) return null;
      if (!str(accountId) || typeof match !== 'object' || match === null) return null;
      for (const id of [label, whenLabel]) if (id !== undefined && (typeof id !== 'string' || !LABEL_ID.test(id))) return null;
      if (disposition !== undefined && !decided(disposition)) return null;
      // A rule says what mail is, what happens to it, or what happens when it is a given label.
      if (label === undefined && whenLabel === undefined && disposition === undefined) return null;
      if (label !== undefined && whenLabel !== undefined) return null;
      if ((markRead !== undefined && typeof markRead !== 'boolean') || (unsubscribe !== undefined && typeof unsubscribe !== 'boolean')) return null;
      const conditions = Object.entries(match).filter(([, value]) => value !== '');
      if (conditions.length === 0 || !conditions.every(([key, value]) => RULE_KEYS.has(key) && str(value))) return null;
      const id = await addRule(
        db,
        accountId,
        {
          match: Object.fromEntries(conditions),
          ...(typeof label === 'string' ? { labelId: label } : {}),
          ...(typeof whenLabel === 'string' ? { whenLabel } : {}),
          ...(disposition ? { disposition } : {}),
          ...(markRead ? { markRead } : {}),
          ...(unsubscribe ? { subscription: 'unsubscribe' as const } : {}),
          ...(typeof when === 'string' && when.trim() !== '' ? { when } : {}),
        },
        'user',
        now(),
      );
      return { id, redecided: await redecide(db, now, accountId) };
    },
  },
  {
    path: '/api/rules/filter',
    touches: ownerOf('rules'),
    run: async ({ db, controls, now }, body) => {
      const { id, on } = body;
      if (!str(id, 40) || typeof on !== 'boolean') return null;
      if (!controls) throw new Error('This dashboard cannot change Gmail filters.');
      // Taking a filter out is always allowed: it only reduces what runs unattended.
      if (on && !controls.settings().act) throw new Error('sift is only observing, so it writes nothing to Gmail. Let it act first, in Settings.');
      await controls.ruleFilter(db, id, on);
      return { filterId: (await getRuleFilter(db, id))?.filterId ?? null, filter: (await ruleFilterStatus(db, now())).get(id) ?? null };
    },
  },
  {
    path: '/api/rules/remove',
    touches: ownerOf('rules'),
    run: async ({ db, controls, now }, body) => {
      if (!str(body['id'], 40)) return null;
      const owner = (await getRuleFilter(db, body['id']))?.accountId ?? null;
      // A filter left behind would keep acting on mail with no rule to explain or remove it.
      if ((await getRuleFilter(db, body['id']))?.filterId) {
        if (!controls) throw new Error('This rule is also a Gmail filter, which this dashboard cannot remove.');
        await controls.ruleFilter(db, body['id'], false);
      }
      if (!(await removeRule(db, body['id']))) throw new Error('That rule no longer exists.');
      return { ok: true, redecided: await redecide(db, now, owner ?? undefined) };
    },
  },
];
