import { ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { money, plural } from '@/lib/format.ts';
import { Button, Copyable, Failure, Field, Form, Input, Select, Sub, Table, Td, TextLink, Th, Tr } from '@/system';

type Choice = ManageState['model']['choices'][number];

/** How each way to a model is paid for, in a line. */
const HOW: Record<string, string> = {
  'openai-codex': 'With a ChatGPT Plus or Pro plan. No bill per message.',
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
      <thead className="sr-only">
        <Tr>
          <Th>Provider</Th>
        </Tr>
      </thead>
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

type Trial = Awaited<ReturnType<typeof api.tryModel>>;

/** What trying a model found, in a sentence. */
function said(trial: Trial): string {
  const matched = trial.checked > 0 ? ` It agreed with you on ${trial.matched} of ${trial.checked}.` : '';
  return `Asked about ${plural(trial.asked, 'recent message')}: ${trial.answered} answered, ${(trial.ms / 1000).toFixed(1)} s each, ${money(trial.costUsd)} in all.${matched}`;
}

/**
 * Signing in to one provider, choosing its model and trying it on a few recent messages. Nothing about
 * what sorts mail changes here: `ready` is the model to switch to, once it has answered.
 */
export function useProviderConnect(choice: Choice, model: ManageState['model'], reload: () => void) {
  const signedIn = model.signedIn.includes(choice.provider);
  const listed = useLoaded(`models ${model.signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const mine = (listed.data?.models ?? []).filter((m) => m.startsWith(`${choice.provider}/`));
  const recommended = listed.data?.recommended[choice.provider] ?? mine[0] ?? '';
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? recommended;
  const [trial, setTrial] = useState<{ model: string; result: Trial } | null>(null);
  const [key, setKey] = useState('');
  const sign = useAction();
  const trying = useAction();
  const tried = trial?.model === chosen ? trial.result : null;
  const pending = model.pending;

  const fields = (
    <Form onSubmit={() => {}}>
      {choice.how === 'chatgpt' ? (
        <Field
          label="Account"
          hint={
            signedIn ? undefined : pending && 'code' in pending ? (
              <>
                Enter this code at{' '}
                <TextLink href={pending.url} away>
                  {new URL(pending.url).host}
                </TextLink>
                . This finishes by itself once you have.
              </>
            ) : (
              <Failure>{sign.error ?? (pending && 'error' in pending ? pending.error : null)}</Failure>
            )
          }
        >
          {signedIn ? (
            <span>Signed in</span>
          ) : pending && 'code' in pending ? (
            <Copyable value={pending.code} label="the code" />
          ) : (
            <Button busy={sign.busy} onClick={() => sign.run(() => api.signInChatGPT(), reload)}>
              Sign in with ChatGPT
            </Button>
          )}
        </Field>
      ) : (
        <Field label="API key" hint={signedIn ? 'Encrypted with your own data. It is checked when you try a model.' : <Failure>{sign.error}</Failure>}>
          {signedIn ? (
            <span>Saved</span>
          ) : (
            <>
              <Input
                type="password"
                autoComplete="off"
                autoFocus
                aria-label="API key"
                placeholder="Paste the key"
                className="min-w-48 flex-1 font-mono"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                busy={sign.busy}
                disabled={key.trim() === ''}
                onClick={() =>
                  sign.run(
                    () => api.saveModelKey(choice.provider, key),
                    () => (setKey(''), reload()),
                  )
                }
              >
                Save
              </Button>
            </>
          )}
        </Field>
      )}
      {signedIn ? (
        <Field
          label="Model"
          hint={
            tried ? (
              tried.error ? (
                <Failure>{tried.error}</Failure>
              ) : (
                said(tried)
              )
            ) : (
              <>
                {trying.error ? (
                  <Failure>{trying.error}</Failure>
                ) : (
                  'A small one is usually enough. Try it on a few recent messages first; each is a paid call.'
                )}
              </>
            )
          }
        >
          <Select
            label="Model"
            value={chosen}
            options={
              mine.length === 0
                ? [['', listed.loading ? 'Listing models…' : 'No models'] as const]
                : mine.map((m) => [m, m.slice(choice.provider.length + 1)] as const)
            }
            onChange={setPicked}
          />
          <Button
            busy={trying.busy}
            disabled={chosen === '' || tried !== null}
            onClick={() =>
              trying.run(async () => {
                const result = await api.tryModel(chosen);
                setTrial({ model: chosen, result });
              })
            }
          >
            {tried ? 'Tried' : 'Try it'}
          </Button>
        </Field>
      ) : null}
    </Form>
  );
  return { fields, ready: tried && !tried.error && tried.answered > 0 ? chosen : null };
}
