import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ManageState, Usage } from '@/lib/api.ts';
import { approx, atApiPrices } from '@/lib/prices.ts';
import { ago, dateTime, money } from '@/lib/format.ts';
import { Figure, Figures, HoverCard, Spark, Tooltip } from '@/system';

type Accounts = ManageState['accounts'];
/** The way in to the model when it is a subscription, whose plan pays for the calls: the sums are API prices. */
type Plan = ManageState['model']['choices'][number] | null;

/** Re-renders every half minute, so "just now" becomes "1 min ago" with nothing loaded. */
function useTicking() {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}

/** What the model cost over each window, and its shape over the 30 days: the hover card, and on a phone the menu. */
export function UsageDetail({ usage, plan }: { usage: Usage; plan: Plan }) {
  const first = new Date(Date.now() - (usage.daily.length - 1) * 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="flex flex-col gap-4">
      <Figures compact>
        <Figure compact label="24H" value={money(usage.day)} />
        <Figure compact label="7D" value={money(usage.week)} />
        <Figure compact label="30D" value={money(usage.month)} />
      </Figures>
      <Spark values={usage.daily} from={first} to="Today" />
      {plan ? <p className="text-sm text-muted-foreground">{atApiPrices(plan)}</p> : null}
    </div>
  );
}

/**
 * The masthead's line: how long since the mailbox that synced longest ago last did (each one's time when pointed at), then
 * what the model cost over 30 days, which previews the rest and links to Activity.
 */
export function SiftStatus({ accounts, usage, plan }: { accounts: Accounts; usage: Usage | null; plan: Plan }) {
  useTicking();
  const synced = accounts.flatMap((a) => (a.lastSyncedAt === null ? [] : [{ email: a.email, at: a.lastSyncedAt }]));
  return (
    <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
      {accounts.length === 0 ? (
        'No account connected'
      ) : (
        <Tooltip says={synced.map((a) => `${a.email}: ${dateTime(a.at)}`).join('\n')} className="flex items-center gap-1.5">
          <RefreshCwIcon aria-hidden className="size-3.5" />
          <span className="sr-only">Synced</span>
          {synced.length > 0 ? ago(Math.min(...synced.map((a) => a.at))) : 'Not synced yet'}
        </Tooltip>
      )}
      {usage ? (
        <>
          <span aria-hidden>·</span>
          <HoverCard href="/activity" card={<UsageDetail usage={usage} plan={plan} />}>
            {/* Through a plan, only about what the API would have charged: the card says so. */}
            <span className="text-foreground">{approx(usage.month, plan)}</span> <span className="text-label">30D</span>
          </HoverCard>
        </>
      ) : null}
    </span>
  );
}
