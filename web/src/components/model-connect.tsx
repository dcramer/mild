import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { money, plural } from '@/lib/format.ts';
import { Button, ChoiceGroup, Copyable, Disclosure, Fact, Facts, Failure, Form, Heads, Input, Select, Sub, Table, Td, TextLink, Th, Tr } from '@/system';

type Choice = ManageState['model']['choices'][number];

/** How each way to a model is paid for, in a line. */
const HOW: Record<string, string> = {
  'openai-codex': 'With a ChatGPT Plus or Pro plan. No bill per message.',
  chatgpt: 'With a ChatGPT Plus or Pro plan. No bill per message.',
  openai: 'Billed per message by OpenAI.',
  anthropic: 'Billed per message by Anthropic.',
  openrouter: 'One key for several labs’ models, billed by OpenRouter.',
  'vercel-ai-gateway': 'One key for several labs’ models, billed through Vercel.',
};

/** A provider's name, without the "API key" its choice label carries. */
export const providerName = (choice: Choice | undefined, provider: string) => choice?.label.replace(/ API key$/, '') ?? provider;

/** The ways to a model, each row pressable. The one in use is shown, and cannot be chosen again. */
export function ProviderList({ choices, inUse, onChoose }: { choices: readonly Choice[]; inUse: string | null; onChoose: (choice: Choice) => void }) {
  return (
    <Table>
      <Heads>
        <Th>Provider</Th>
      </Heads>
      <tbody>
        {choices.map((choice) =>
          choice.provider === inUse ? (
            <Tr key={choice.provider}>
              <Td>
                <span className="name">{providerName(choice, choice.provider)}</span>
                <Sub>In use</Sub>
              </Td>
            </Tr>
          ) : (
            <Tr key={choice.provider} onOpen={() => onChoose(choice)}>
              <Td>
                <span className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="name">{providerName(choice, choice.provider)}</span>
                    <Sub className="whitespace-normal">{HOW[choice.provider] ?? ''}</Sub>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </span>
              </Td>
            </Tr>
          ),
        )}
      </tbody>
    </Table>
  );
}

/** Where to make an API key, for the providers whose page for it is known. */
const KEY_PAGE: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
};

/**
 * The way in to the model in use when it is a subscription (ChatGPT), whose plan is not charged by the message:
 * a price through it is only what the same use would cost through the API, and is said to be.
 */
export function subscription(model: Pick<ManageState['model'], 'choices' | 'chosen'>): Choice | null {
  const provider = model.chosen?.split('/')[0];
  return model.choices.find((c) => c.provider === provider && c.how !== 'key') ?? null;
}

/** Said after a price through a subscription. */
const AT_API_PRICES = 'at API prices';
/** Said of a price through a subscription, once in each place one is shown: the person does not pay it. */
const covers = (plan: Choice) => `which your ${plan.label} plan covers`;

/** A sum spent or to spend, and through a subscription that it is an API price the plan covers, said once wherever sums are shown together. */
export const atApiPrices = (plan: Choice) => `At API prices, ${covers(plan)}.`;

/** What classifying with a model costs, about so much per 1,000 messages. Null when the catalog has no price. */
export function costLine(choice: Choice | undefined, costs: Record<string, number>, model: string): string | null {
  const cost = costs[model];
  if (cost === undefined) return null;
  if (choice && choice.how !== 'key') return `About ${money(cost)} per 1,000 messages ${AT_API_PRICES}, ${covers(choice)}.`;
  return `About ${money(cost)} per 1,000 messages.`;
}

/** What going through so many messages would cost, as the inbox's row says it. */
export function costOfMessages(usd: number, subscribed: Choice | null): string {
  return subscribed ? `About ${money(usd)} ${AT_API_PRICES}, ${covers(subscribed)}.` : `Going through them costs about ${money(usd)}.`;
}

/** What the model cost over the last 30 days, for so many messages, as Settings says it. */
export function spentLine(usd: number, messages: number, subscribed: Choice | null): string {
  return subscribed
    ? `${money(usd)} ${AT_API_PRICES} in the last 30 days, for ${plural(messages, 'message')}, ${covers(subscribed)}.`
    : `${money(usd)} in the last 30 days, for ${plural(messages, 'message')}.`;
}

/** Under a price figure: the model it is for and, through a subscription, that it is an API price. */
export function priceNote(model: string | null, subscribed: Choice | null): string | null {
  const on = model ? `on ${model.slice(model.indexOf('/') + 1)}` : null;
  return subscribed ? [on, AT_API_PRICES].filter(Boolean).join(', ') : on;
}

/** The press a step ends with: a link out, or something done here. */
export interface Next {
  label: string;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

/**
 * Signing in to one provider and choosing its model, a step at a time: `title` says what to do now, `body`
 * holds it, and `next` is the press that does it, until the provider is connected and `next` is null.
 * Nothing about what classifies mail changes here: `ready` is the model to switch to.
 */
export function useProviderConnect(choice: Choice, model: ManageState['model'], reload: () => void) {
  const name = providerName(choice, choice.provider);
  const signedIn = model.signedIn.includes(choice.provider);
  const listed = useLoaded(`models ${model.signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const mine = (listed.data?.models ?? []).filter((m) => m.startsWith(`${choice.provider}/`));
  const shortlist = listed.data?.shortlist[choice.provider] ?? [];
  const costs = listed.data?.costs ?? {};
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? shortlist[0] ?? mine[0] ?? '';
  const [changing, setChanging] = useState(false);
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const sign = useAction();
  const pending = model.pending;
  const started = pending && 'url' in pending ? pending : null;
  const code = started?.code === undefined ? null : { ...started, code: started.code };
  const failed = sign.error ?? (pending && 'error' in pending ? pending.error : null);
  const chatgpt = choice.how !== 'key';
  // ChatGPT has only the one way in, so choosing it starts it: there is nothing else to press first.
  const asked = useRef(false);
  useEffect(() => {
    if (!chatgpt || signedIn || started || asked.current) return;
    asked.current = true;
    sign.run(() => api.signInChatGPT(), reload);
  });
  // The code, and then the sign-in finishing at OpenAI, are only learnt of by asking.
  const waiting = chatgpt && !signedIn;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [waiting, reload]);
  const short = (m: string) => m.slice(choice.provider.length + 1);

  if (signedIn) {
    const cost = costLine(choice, costs, chosen);
    const per = (m: string) => (costs[m] === undefined ? null : `${money(costs[m])} per 1,000 messages${chatgpt ? ` ${AT_API_PRICES}` : ''}`);
    const notes = Object.fromEntries(
      shortlist.map((m, index) => {
        const price = per(m);
        if (index === 0) return [m, price ? `Recommended · about ${price}` : 'Recommended'];
        return [m, price ? `About ${price}` : ''];
      }),
    );
    const every = <Select label="Model" value={chosen} options={mine.map((m) => [m, short(m)] as const)} onChange={setPicked} />;
    const body =
      chosen === '' ? (
        listed.loading ? (
          <p className="text-muted-foreground">Listing models…</p>
        ) : (
          <Failure>{listed.data?.error ?? `${name} offers no models Sift can use.`}</Failure>
        )
      ) : changing ? (
        <>
          {shortlist.length > 0 ? (
            <ChoiceGroup
              label="Model"
              value={chosen}
              options={shortlist.map((m) => [m, short(m)] as const)}
              notes={notes}
              onChange={(m) => m && setPicked(m)}
            />
          ) : null}
          {mine.length > shortlist.length ? shortlist.length > 0 ? <Disclosure summary={`Every model (${mine.length})`}>{every}</Disclosure> : every : null}
        </>
      ) : (
        <Facts>
          <Fact term="Model">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {short(chosen)}
              {mine.length > 1 ? (
                // Pulled into the line's height, so the value stays level with its term.
                <Button variant="quiet" className="-my-2" onClick={() => setChanging(true)}>
                  Change
                </Button>
              ) : null}
            </span>
          </Fact>
          {cost ? <Fact term="Cost">{cost}</Fact> : null}
        </Facts>
      );
    return { title: `${name} is connected.`, body, next: null, ready: chosen === '' ? null : chosen };
  }

  if (choice.how === 'key') {
    const save = () =>
      key.trim() !== '' &&
      sign.run(
        () => api.saveModelKey(choice.provider, key),
        () => (setKey(''), reload()),
      );
    const page = KEY_PAGE[choice.provider];
    return {
      title: `Paste your ${name} key.`,
      body: (
        <>
          <Form onSubmit={save}>
            <Input
              type="password"
              autoComplete="off"
              autoFocus
              aria-label="API key"
              className="w-full font-mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </Form>
          {page ? (
            <p className="text-sm text-muted-foreground">
              No key yet? Make one at{' '}
              <TextLink href={page} away>
                {new URL(page).host}
              </TextLink>
              .
            </p>
          ) : null}
          <Failure>{sign.error}</Failure>
        </>
      ),
      next: { label: 'Continue', busy: sign.busy, disabled: key.trim() === '', onPress: save },
      ready: null,
    };
  }

  const getting = sign.busy || !failed;
  if (choice.how === 'device-code')
    return {
      title: `Enter this code at ${name}.`,
      body: code ? (
        <>
          <Copyable value={code.code} label="the code" />
          <p className="text-sm text-muted-foreground">This page moves on once you have.</p>
        </>
      ) : getting ? (
        <p className="text-muted-foreground">Getting a code…</p>
      ) : (
        <Failure>{failed}</Failure>
      ),
      next: code
        ? { label: 'Copy and open', href: code.url, onPress: () => void navigator.clipboard?.writeText(code.code).catch(() => {}) }
        : getting
          ? { label: 'Copy and open', disabled: true }
          : { label: 'Get a new code', onPress: () => sign.run(() => api.signInChatGPT(), reload) },
      ready: null,
    };

  const finish = () =>
    address.trim() !== '' &&
    sign.run(
      () => api.finishChatGPT(address),
      () => (setAddress(''), reload()),
    );
  return {
    title: `Sign in to ${name}.`,
    body:
      started && !sign.error ? (
        <>
          <p className="text-sm text-muted-foreground">
            After signing in, {name} sends you to a page that will not load. Copy its address from the address bar and paste it here.
          </p>
          <Form onSubmit={finish}>
            <Input
              autoComplete="off"
              aria-label={`Address of the page ${name} sent you to`}
              placeholder="http://127.0.0.1:1455/auth/callback?code=…"
              className="w-full font-mono"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Form>
        </>
      ) : getting ? (
        <p className="text-muted-foreground">Starting…</p>
      ) : (
        <Failure>{failed}</Failure>
      ),
    next:
      started && !sign.error
        ? address.trim() === ''
          ? { label: `Open ${name}`, href: started.url }
          : { label: 'Finish', busy: sign.busy, onPress: finish }
        : getting
          ? { label: `Open ${name}`, disabled: true }
          : { label: 'Start again', onPress: () => (setAddress(''), sign.run(() => api.signInChatGPT(), reload)) },
    ready: null,
  };
}
